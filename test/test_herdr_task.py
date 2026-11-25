"""herdr-task: every module compiles, the add-on switch it reads, and (on CI only, where HOME is
a throwaway) its commands start. On a person's machine herdr-task never runs with another HOME."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import datetime
import json
import os
import re
import subprocess
import sys
import tempfile
import types
import time
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

    def test_plugin_off(self):
        """3.2: Settings › Plugins (Everywhere's plugins_off) is what herdr-task obeys; 3.1's add-on list ("off") is
        ignored. Screens off: no browser for a worker (asked as "browser", its 3.1 name)."""
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"everywhere": {"plugins_off": ["screens", "schedules"], "off": ["voice", "machines"]}}, f)
        code = ("import sys; sys.dont_write_bytecode = True; sys.path.insert(0, sys.argv[1]);"
                "from herdr_task.base import addon_off, plugin_off;"
                "print(addon_off('browser'), plugin_off('screens'), plugin_off('schedules'), plugin_off('voice'), plugin_off('machines'), plugin_off('reactions'))")
        env = {**os.environ, "HERDR_TASK_SETTINGS": f.name}
        out = subprocess.run([sys.executable, "-c", code, BIN], capture_output=True, text=True, env=env)
        os.unlink(f.name)
        self.assertEqual(out.stdout.split(), ["True", "True", "True", "False", "False", "False"], out.stderr)

    def test_reactions_plugin_off_is_reactions_off(self):
        sys.path.insert(0, BIN)
        from herdr_task import settings
        on = {"everywhere": {"agents": {"reactions": True}}, "spaces": {"sp1": {"agents": {"reactions": True}}}}
        self.assertTrue(settings.reactions_on("sp1", on))
        off = {**on, "everywhere": {**on["everywhere"], "plugins_off": ["reactions"]}}
        self.assertFalse(settings.reactions_on("sp1", off))
        self.assertFalse(settings.reactions_on(None, off))

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

    def test_tell_always_says_whether_it_arrived(self):
        """#1079 #1141: tell-assistant never returned, and nobody knew whether it went. It ends within its wait and
        says delivered or not, and why: from Codex's sandbox, that Herdr can't be reached."""
        sys.path.insert(0, BIN)
        import argparse
        import io
        from contextlib import redirect_stdout
        from unittest import mock
        from herdr_task import machines
        from herdr_task.base import Fail
        args = argparse.Namespace(target="t3", text="hi", json=False)
        sandbox = subprocess.CompletedProcess([], 1, "", '{"error":{"message":"cannot start core: Read-only file system (os error 30)"}}')
        with mock.patch.object(machines.subprocess, "run", return_value=sandbox), \
                mock.patch.object(machines, "tell", side_effect=AssertionError("never tried")):
            with self.assertRaises(Fail) as e:
                machines.cmd_tell(args)
        self.assertIn("Not delivered to t3: a sandbox", str(e.exception))
        ok = subprocess.CompletedProcess([], 0, "{}", "")
        with mock.patch.object(machines.subprocess, "run", return_value=ok):
            with mock.patch.object(machines, "tell", side_effect=lambda *a: time.sleep(5)), \
                    mock.patch.dict(os.environ, {"HERDR_TASK_TELL_WAIT": "1"}):
                t0 = time.time()
                with self.assertRaises(Fail) as e:
                    machines.cmd_tell(args)
                self.assertLess(time.time() - t0, 3)
            self.assertIn("Not delivered to t3: no answer from Herdr in 1 s", str(e.exception))
            with mock.patch.object(machines, "tell", side_effect=Fail("couldn't deliver to t3")):
                with self.assertRaises(Fail) as e:
                    machines.cmd_tell(args)
            self.assertEqual(str(e.exception), "Not delivered to t3: couldn't deliver to t3")
            with mock.patch.object(machines, "tell", return_value={"to": "t3", "space": "shop", "can_reply": True, "held": False}):
                out = io.StringIO()
                with redirect_stdout(out):
                    machines.cmd_tell(args)
            self.assertEqual(out.getvalue().strip(), "Delivered to t3 (shop).")

    @unittest.skipUnless(CI, "runs only on CI: herdr-task never runs with a changed HOME on a person's machine")
    def test_commands_start(self):
        home = tempfile.mkdtemp()
        env = {**os.environ, "HOME": home, "HERDR_TASK_STORE": os.path.join(home, "tasks")}
        for args in (["--help"], ["--version"], ["list", "--help"], ["machines", "sync", "--help"]):
            p = subprocess.run([sys.executable, os.path.join(BIN, "herdr-task"), *args], capture_output=True, text=True, env=env)
            self.assertEqual(p.returncode, 0, f"herdr-task {' '.join(args)}: {p.stderr}")


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
            asks = argv[:2] == ["hc", "exec"] and argv[-1] == cli.HAS_SOURCE   # does that machine hold the source?
            return subprocess.CompletedProcess(argv, (0 if self.source else 1) if asks else 0, "" if asks else "{}", "")

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
        self.cli.remote_run("vm", ["auto", "list", "--json"])
        self.assertEqual(self.wrote[0][:5], ["hc", "file", "write", "--on", "vm"])

    def test_a_machine_holding_the_source_is_never_written_to(self):
        self.source = True
        self.cli.remote_run("mini", ["auto", "list", "--json"])
        self.cli.remote_run("mini", ["auto", "list", "--json"])
        self.assertEqual(self.wrote, [])
        self.assertEqual(sum(1 for a in self.ran if a[-1] == self.cli.HAS_SOURCE), 1)  # asked once, then remembered
        self.assertEqual(self.ran[-1][-3:], ["auto", "list", "--json"])


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
    tick it skipped every time, so nothing after the tick ever ran."""

    def test_a_round_waits_for_the_tick_and_runs(self):
        import fcntl
        import threading
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.automations as au
        import herdr_task.home as home
        store = tempfile.mkdtemp()
        ran = []
        patches = [mock.patch.object(au, "STORE", store), mock.patch.object(au, "SEEN", os.path.join(store, ".seen.json")),
                   mock.patch.object(au, "store_files", lambda *a: []), mock.patch.object(home, "home_pass", ran.append)]
        patches += [mock.patch.object(au, n, lambda *a, **k: None) for n in (
            "stopped_pass", "archive_pass", "news_pass", "end_done_pass", "memory_guard", "cli_check_pass", "machines_pass")]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        # a tick holds the lock as the round starts, and lets go a moment later
        tick = open(os.path.join(store, ".tick.lock"), "a")
        fcntl.flock(tick, fcntl.LOCK_EX)
        threading.Timer(0.5, lambda: (fcntl.flock(tick, fcntl.LOCK_UN), tick.close())).start()
        au.one_pass({})
        self.assertEqual(len(ran), 1, "the round gave way to the tick and skipped its passes")
        self.assertTrue(os.path.exists(os.path.join(store, ".seen.json")))
        # a lock held past the wait: this round skips, the scheduler tries again in 15 s
        with open(os.path.join(store, ".tick.lock"), "a") as held:
            fcntl.flock(held, fcntl.LOCK_EX)
            with mock.patch.object(au, "LOCK_WAIT_S", 0.3):
                au.one_pass({})
        self.assertEqual(len(ran), 1)


class MemoryGuardRepeat(unittest.TestCase):
    """#1047: memory hovering at 85-86% toasted every tick: each dip to 85% removed the guard file and with it
    the time of the last alert. Now one alert per 30 min while it stays near the limit."""

    def test_one_alert_while_memory_hovers(self):
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.tick as tick
        import herdr_task.machine as machine
        store = tempfile.mkdtemp()
        mem, clock, labels = [86], [10_000_000], []
        ok = type("R", (), {"returncode": 0})()
        for obj, name, value in ((tick, "GUARD_FILE", os.path.join(store, ".memory-guard.json")),
                                 (machine, "sample", lambda: {"memory": mem[0]}), (tick, "now", lambda: clock[0]),
                                 (tick, "end_done_pass", lambda r, pressed=False: []),
                                 (tick, "hc_json", lambda *a: {"state": "live"} if a[0] == "get" else {"terminals": []}),
                                 (tick, "run", lambda argv: (labels.append(argv), ok)[1]), (tick, "machine_name", lambda: "vm")):
            p = mock.patch.object(obj, name, value)
            p.start()
            self.addCleanup(p.stop)
        for reading in [86, 85, 86, 85, 86, 86, 85, 86]:  # one tick every 15 s for two minutes
            mem[0] = reading
            tick.memory_guard({})
            clock[0] += 15_000
        self.assertEqual(len(labels), 1, "alerted again after a dip to the limit")
        clock[0] += tick.GUARD_ALERT_EVERY_MS
        mem[0] = 86
        tick.memory_guard({})
        self.assertEqual(len(labels), 2, "half an hour on, still high: told again")
        # well under: forgotten, so a new climb is told at once
        mem[0] = 60
        tick.memory_guard({})
        self.assertFalse(os.path.exists(tick.GUARD_FILE))
        clock[0] += 15_000
        mem[0] = 90
        tick.memory_guard({})
        self.assertEqual(len(labels), 3)

    def test_its_alert_label_goes_once_memory_is_back_under(self):
        """SHEP-246: the guard's herdr.alert stayed on the scheduler for days after memory dropped (a phone's glance
        listed "Memory at 90%" at 7%): back under, the label goes; an agent's own alert there stays."""
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.tick as tick
        import herdr_task.machine as machine
        store = tempfile.mkdtemp()
        mem, labels = [60], []
        held = [json.dumps({"id": "a1", "at": 1, "title": "Memory at 90%", "body": "x", "about": True, "task": "vm"})]
        ok = type("R", (), {"returncode": 0})()
        for obj, name, value in ((tick, "GUARD_FILE", os.path.join(store, ".memory-guard.json")),
                                 (machine, "sample", lambda: {"memory": mem[0]}), (tick, "now", lambda: 10_000_000),
                                 (tick, "end_done_pass", lambda r, pressed=False: []),
                                 (tick, "hc_json", lambda *a: {"state": "live", "labels": {"herdr.alert": held[0]}} if a[0] == "get" else {"terminals": []}),
                                 (tick, "run", lambda argv: (labels.append(argv), ok)[1]), (tick, "machine_name", lambda: "vm"),
                                 (tick, "_guard_label_checked", False)):
            p = mock.patch.object(obj, name, value)
            p.start()
            self.addCleanup(p.stop)
        # a label left by an older version, no guard file: cleared once at the scheduler's start
        tick.memory_guard({})
        self.assertEqual(labels, [["hc", "label", tick.SCHEDULER, "herdr.alert="]])
        tick.memory_guard({})
        self.assertEqual(len(labels), 1, "checked once, not every tick")
        # high, alerted, then back under: cleared
        mem[0] = 92
        tick.memory_guard({})
        self.assertEqual(len(labels), 2)
        mem[0] = 50
        tick.memory_guard({})
        self.assertEqual(labels[-1], ["hc", "label", tick.SCHEDULER, "herdr.alert="])
        # an agent's own alert on that terminal is not the guard's: left alone
        held[0] = json.dumps({"id": "b2", "at": 1, "title": "Look now", "body": "y"})
        with open(tick.GUARD_FILE, "w") as f:
            json.dump({"alerted": 1}, f)
        n = len(labels)
        tick.memory_guard({})
        self.assertEqual(len(labels), n)


class AcceptWhenHcCantStart(unittest.TestCase):
    """#1057: Accept ended in a traceback at its first hc call (busy_again(t, [detail(k) for k in live_agents(...)])) when
    hc couldn't be started. A real herdr-task accept on a throwaway store, its hc one the system can't run."""

    def test_a_plain_refusal_never_a_traceback(self):
        tmp = tempfile.mkdtemp()
        store, repo, fakebin = (os.path.join(tmp, n) for n in ("store", "repo", "bin"))
        os.makedirs(fakebin)
        subprocess.run(["git", "init", "-q", repo], check=True)
        subprocess.run(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "init"], check=True)
        hc = os.path.join(fakebin, "hc")
        with open(hc, "w") as f:
            f.write('#!/bin/sh\necho \'{"terminals": []}\'\n')
        os.chmod(hc, 0o755)
        # on this run's throwaway HOME herdr-task refuses hc (base.not_real): this hc is a fake, so let it
        b = ("import sys, runpy; sys.dont_write_bytecode = True; sys.path.insert(0, sys.argv[1]);"
             "import herdr_task.base as base; base.not_real = lambda: None;"
             "sys.argv = sys.argv[2:]; runpy.run_path(sys.argv[0], run_name='__main__')")
        env = {**os.environ, "HERDR_TASK_STORE": store, "PATH": fakebin + os.pathsep + "/usr/bin:/bin"}
        ht = lambda *a: subprocess.run([sys.executable, "-c", b, BIN, os.path.join(BIN, "herdr-task"), *a, "--folder", repo],
                                       capture_output=True, text=True, env=env, cwd=repo)
        self.assertEqual(ht("add", "Try accept", "--here").returncode, 0)
        [path] = [os.path.join(store, f) for f in os.listdir(store) if f.endswith(".json")]
        with open(path) as f:
            d = json.load(f)
        d["tasks"][0].update(state="ready", ready_at=1, ready_turns={})
        with open(path, "w") as f:
            json.dump(d, f)
        with open(hc, "w") as f:
            f.write("echo no first line, so the system can't start it\n")  # Exec format error
        p = ht("accept", "1")
        self.assertNotIn("Traceback", p.stderr)
        self.assertEqual(p.returncode, 1)
        self.assertIn("herdr-task: couldn't start hc", p.stderr)
        with open(path) as f:
            self.assertEqual(json.load(f)["tasks"][0]["state"], "ready")


def home_round(home, machines_mod, world, here, store, cfg=None, at=None, down=()):
    """One home round (home_pass) as machine `here` of a fake `world` runs it: {name: {core, window,
    links (names it reads), linked_by, space, assistant, news, health}}. hc, herdr-app and the
    other machines are never reached: their reports come from the world (`down`: not answering).
    Returns [(to, line)] it sent. Also used for #1029's before/after proof."""
    from unittest import mock
    me = world[here]
    sent = []

    def report(name, since, news_only):
        w = world[name]
        out = {"home": "/home/" + name, "at": 0, "space": w["space"], "assistant": w["assistant"], "core": w["core"],
               "core_name": name, "overview": w["window"], "links": sorted(world[n]["core"] for n in w["links"]),
               "linked_by": w["linked_by"]}
        if since is not None:
            out["news"] = [dict(x, at=since + 1) for x in w.get("news") or []]
        if not news_only:
            out.update(health=w["health"], top={}, stuck=[], worktrees=[])
        if "stale_links" in w:
            out["stale_links"] = w["stale_links"]
        return out

    def remote(m, candidates, since, news_only, timeout=40):
        if m in down:
            raise home.Fail("timed out")
        return report(m, since, news_only)

    spaces = [{"id": (n + "/" if n != here else "") + world[n]["space"], "machine": None if n == here else n,
               "name": "~", "folder": "/home/" + n} for n in world]
    ls = mock.Mock(returncode=0, stdout=json.dumps({"spaces": spaces}))
    patches = [mock.patch.object(home, "HOME_STATE", os.path.join(store, ".home-" + here + ".json")),
               mock.patch.object(home, "main_here", lambda: me["window"]),
               mock.patch.object(home, "read_settings", lambda: cfg or {}),
               mock.patch.object(home, "run", lambda *a, **k: ls),
               mock.patch.object(home, "local_report", lambda c, since=None, news_only=False: report(here, since, news_only)),
               mock.patch.object(home, "remote_report", remote),
               mock.patch.object(home, "deliver", lambda to, lines, quiet=None, idle_only=False: sent.extend((to, l) for l in lines) or True),
               mock.patch.object(machines_mod, "connected_machines",
                                 lambda: [{"name": n, "id": world[n]["core"], "state": "connected"} for n in me["links"]])]
    if at is not None:
        patches.append(mock.patch.object(home, "now", lambda: at))
    for p in patches:
        p.start()
    try:
        home.home_pass({}, force=True)
    finally:
        for p in patches:
            p.stop()
    return sent


def home_world(mini_links_laptop=True):
    """Two Macs with a window each: the laptop links to the mini (the hub, which the VM links to as
    well); the mini links back unless told not to. Each has one task's news and a full disk."""
    disk = {"cpu": 5, "load": 0.1, "cores": 8, "memory": 20, "disk": 97, "disks": []}
    news = lambda task: [{"to": "t9", "space": "sp-shop", "folder": "~/shop",
                          "lines": [f'<herdr-news task="{task}" event="needs-you">{task} needs you</herdr-news>']}]
    return {"mini": {"core": "c-mini", "window": True, "links": ["laptop"] if mini_links_laptop else [], "linked_by": 2,
                     "space": "sp1", "assistant": "t1", "news": news("SHOP-1"), "health": disk},
            "laptop": {"core": "c-laptop", "window": True, "links": ["mini"], "linked_by": 1 if mini_links_laptop else 0,
                       "space": "sp2", "assistant": "t2", "news": news("SHOP-2"), "health": disk}}


class HomeLead(unittest.TestCase):
    """#1029: with windows on two machines, the hub (the one the others link to) keeps the overview;
    each window still tells its own home Assistant its own health. home_pass with a fake world."""

    CFG = {"machines": {"mini": {"home": True}, "laptop": {"home": True}}}

    def setUp(self):
        sys.path.insert(0, BIN)
        import herdr_task.home as home
        import herdr_task.machines as machines
        self.home, self.machines = home, machines
        self.store = tempfile.mkdtemp()

    def round(self, world, here, **kw):
        return home_round(self.home, self.machines, world, here, self.store, cfg=self.CFG, **kw)

    def overview(self, sent):
        return [(to, l) for to, l in sent if l.startswith("<herdr-overview")]

    def lead(self, name):
        with open(os.path.join(self.store, f".home-{name}.json")) as f:
            return json.load(f)["lead"]

    def test_the_hub_leads_and_each_window_tells_its_own_health(self):
        world = home_world()
        mini, laptop = self.round(world, "mini"), self.round(world, "laptop")
        # The mini (more machines link to it) leads: both machines' news and the laptop's health, once.
        ov = self.overview(mini)
        self.assertEqual({to for to, _ in ov}, {"t1"})
        self.assertEqual(sorted(l.split(">", 1)[1].split("<")[0] for _, l in ov),
                         ["Machine laptop: Disk crossed its alert limit (Disk 97%)", "laptop · ~/shop: SHOP-2 needs you", "~/shop: SHOP-1 needs you"])
        self.assertEqual(self.overview(laptop), [], "the laptop sent the overview too")
        # Health: each window tells its own home Assistant, never the other's.
        health = lambda sent: [to for to, l in sent if l.startswith("<herdr-health")]
        self.assertEqual(health(mini), ["t1"])
        self.assertEqual(health(laptop), ["t2"])
        self.assertEqual((self.lead("mini"), self.lead("laptop")), (None, "mini"))

    def test_shep_310_a_broken_link_reaches_home_health_once_with_what_to_do(self):
        world = home_world()
        world["mini"]["stale_links"] = [{"name": "vm-demo", "answers": "e5a9"}]
        line = lambda sent: [(to, l) for to, l in sent if 'event="link-stale"' in l]
        [(to, l)] = line(self.round(world, "mini", at=1))
        self.assertEqual(to, "t1", "this machine's own home Assistant")
        self.assertIn("The link to vm-demo is broken: a different herdr-core answers there now", l)
        self.assertIn("Run `herdr-task carry-over` here", l)
        self.assertEqual(line(self.round(world, "mini", at=1 + 61000)), [], "told once")
        world["mini"]["stale_links"] = [{"name": "vm-demo", "answers": "f00d"}]
        self.assertEqual(len(line(self.round(world, "mini", at=1 + 122000))), 1, "yet another core there is news again")
        # the stale_links fact itself: from herdr-core's own words on the link (hc machine ls)
        from unittest import mock
        ms = [{"name": "vm-demo", "id": "4f97", "state": "unreachable", "why": 'a different core answers there ("e5a9")', "target": "vm-demo.example.test", "session": "shepherdr"},
              {"name": "vm-off", "id": "1234", "state": "unreachable", "why": "ssh: connect timed out"}]
        with mock.patch.object(self.machines, "connected_machines", lambda: ms):
            self.assertEqual([(x["name"], x["id"], x["answers"]) for x in self.machines.stale_links()], [("vm-demo", "4f97", "e5a9")])
            with mock.patch.object(self.home, "read_settings", lambda: {}), mock.patch.object(self.home, "_core_file", lambda n: None), \
                    mock.patch.object(self.home, "main_here", lambda: True):
                rep = self.home.local_report(news_only=True)
        self.assertEqual(rep["stale_links"], [{"name": "vm-demo", "answers": "e5a9"}])

    def test_a_news_line_with_more_attributes_keeps_its_task_and_event(self):
        """A feedback report's news line carries key= too: the overview still reads its task and event, never
        the tag's attributes as words."""
        world = home_world()
        world["mini"]["news"] = [{"space": "sp-shop", "folder": "~/shop", "lines": [
            '<herdr-news task="SHOP-1" event="feedback" key="fb-1">"Fix login" feedback: the button is small</herdr-news>']}]
        [l] = [l for _, l in self.overview(self.round(world, "mini")) if "SHOP-1" in l]
        self.assertIn('task="SHOP-1"', l)
        self.assertIn('event="feedback"', l)
        self.assertNotIn("key=", l.split(">", 1)[1])

    def test_a_hub_that_doesnt_link_back_gets_none_of_the_others_news(self):
        """#1188: the mini can't reach the laptop, so its home Assistant never gets the laptop's news
        (it could only sum up items it can't check); the laptop's own home Assistant keeps them."""
        world = home_world(mini_links_laptop=False)
        mini, laptop = self.round(world, "mini"), self.round(world, "laptop")
        self.assertEqual([l.split(">", 1)[1].split("<")[0] for _, l in self.overview(mini)], ["~/shop: SHOP-1 needs you"])
        self.assertEqual(self.lead("laptop"), "mini")
        self.assertNotIn("mini/t1", {to for to, _ in laptop}, "the laptop sent its news to a home Assistant that can't reach it")
        self.assertEqual([(to, l.split(">", 1)[1].split("<")[0]) for to, l in self.overview(laptop)], [("t2", "~/shop: SHOP-2 needs you")])

    def test_stale_overview_lines_are_dropped(self):
        """#1188: overview lines queued for another machine's home Assistant (an older version's way),
        or waiting over OVERVIEW_KEEP_MS (30 min), are never sent."""
        world, t = home_world(mini_links_laptop=False), 10 ** 12
        path = os.path.join(self.store, ".home-laptop.json")
        old = lambda to, text, at: {"to": to, "line": f'<herdr-overview machine="laptop">{text}</herdr-overview>', "at": at}
        with open(path, "w") as f:
            json.dump({"at": 0, "outbox": [old("home:mini", "queued for the mini", t - 1000),
                                           old("home:local", "long ago", t - 31 * 60000),
                                           old("home:local", "a minute ago", t - 60000)]}, f)
        world["laptop"]["news"] = []
        sent = self.round(world, "laptop", at=t)
        self.assertEqual([(to, l.split(">", 1)[1].split("<")[0]) for to, l in self.overview(sent)], [("t2", "a minute ago")])
        with open(path) as f:
            self.assertEqual(json.load(f)["outbox"], [])

    def test_a_lone_window_leads(self):
        world = {"mini": dict(home_world()["mini"], links=[], linked_by=0)}
        sent = self.round(world, "mini")
        self.assertEqual([l.split(">", 1)[1].split("<")[0] for _, l in self.overview(sent)], ["~/shop: SHOP-1 needs you"])
        self.assertEqual({to for to, _ in sent}, {"t1"})

    def test_only_what_needs_the_person_from_a_space_with_its_own_assistant(self):
        """GitHub #1126: a space's own live Assistant got its news and acts on it; the overview keeps only what needs
        the person (needs-you, failed), not every ready, done or working-again line."""
        world = {"mini": dict(home_world()["mini"], links=[], linked_by=0)}
        line = lambda task, ev, words: f'<herdr-news task="{task}" event="{ev}">{words}</herdr-news>'
        world["mini"]["news"] = [{"to": "t9", "space": "sp-shop", "folder": "~/shop", "lines": [
            line("SHOP-1", "ready", "SHOP-1 is ready"), line("SHOP-2", "done", "SHOP-2 is done"),
            line("SHOP-3", "working-again", "SHOP-3 is working again"), line("SHOP-4", "stalled", "SHOP-4 looks stuck"),
            line("SHOP-5", "needs-you", "SHOP-5 needs you"), line("SHOP-6", "failed", "SHOP-6 stopped")]}]
        sent = self.round(world, "mini")
        self.assertEqual([l.split(">", 1)[1].split("<")[0] for _, l in self.overview(sent)],
                         ["~/shop: SHOP-5 needs you", "~/shop: SHOP-6 stopped"])

    def test_two_way_ties_agree(self):
        """Both link to each other and as many machines link to each: the lower core id leads, seen from either."""
        world = home_world()
        world["mini"]["linked_by"] = world["laptop"]["linked_by"] = 1
        self.round(world, "mini"), self.round(world, "laptop")
        self.assertEqual((self.lead("mini"), self.lead("laptop")), ("laptop", None))

    def test_a_lead_gone_quiet_is_taken_over_later(self):
        world, t = home_world(), 10 ** 12
        self.round(world, "laptop", at=t)
        # one missed answer: the laptop still gives way (nothing doubled), and waits to tell the mini
        sent = self.round(world, "laptop", at=t + 60000, down=("mini",))
        self.assertEqual(self.overview(sent), [])
        # gone longer than LEAD_KEEP_MS: the laptop keeps the overview itself
        sent = self.round(world, "laptop", at=t + self.home.LEAD_KEEP_MS + 120000, down=("mini",))
        self.assertTrue(self.overview(sent))
        self.assertEqual({to for to, _ in self.overview(sent)}, {"t2"})

    def test_link_facts_counts_who_links_here(self):
        from unittest import mock
        core = tempfile.mkdtemp()
        for name, d in (("core.json", {"id": "c-mini", "name": "mini"}),
                        ("peers.json", {"c-laptop": {"name": "laptop", "calls_me": "mini"}, "c-vm": {"name": "vm", "calls_me": "mini"}})):
            with open(os.path.join(core, name), "w") as f:
                json.dump(d, f)
        with mock.patch.object(self.machines, "_core_dir", lambda: core), \
                mock.patch.object(self.machines, "connected_machines", lambda: [{"name": "laptop", "id": "c-laptop", "state": "connected"},
                                                                               {"name": "old", "id": "c-old", "state": "disconnected"}]), \
                mock.patch.object(self.home, "main_here", lambda: True), mock.patch.object(self.home, "read_settings", lambda: {}):
            f = self.home.link_facts()
        self.assertEqual(f, {"core": "c-mini", "core_name": "mini", "overview": True, "links": ["c-laptop"], "linked_by": 2})


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
                                 (commands, "open_store", lambda args, write=True, wait=None: self.store),
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

    def test_a_turn_nobody_asked_for_keeps_it_ready(self):
        """#1082: a Ready task's Claude compacted (or showed a toast, or a background job's notice woke it): no message
        from anyone, so it stays Ready (no working-again, no second ready news); a message sent to it is new work."""
        log = os.path.join(tempfile.mkdtemp(), "s.jsonl")
        stamp = lambda ms: datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).isoformat().replace("+00:00", "Z")
        user = lambda ms, content, **more: json.dumps({"type": "user", "isSidechain": False, "timestamp": stamp(ms),
                                                         "message": {"role": "user", "content": content}, **more}) + "\n"
        ready_at = 1_800_000_000_000
        with open(log, "w") as f:
            f.write(user(ready_at - 600_000, "Build the login page"))
            f.write(user(ready_at + 60_000, "This session is being continued from a previous conversation...", isCompactSummary=True))
            f.write(user(ready_at + 90_000, "<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>"))
        t = self.ready(ready_at=ready_at, agents=[{"address": "t1", "log": log}])
        working = [self.agent({"address": "t1", "status": "working", "turn": 5, "role": "worker"})]
        self.assertFalse(self.agents.busy_again(t, working))
        self.assertEqual(self.agents.task_status(t, working), ("ready", None, None))
        # the tick leaves it Ready while that turn runs, and once it ends with nothing changed
        report = {}
        self.live = working
        with self.mock.patch.object(self.tick, "mid_turn_agents", lambda live, look=None: live):
            self.tick.back_pass(self.store, t, report)
        self.assertEqual((t["state"], report), ("ready", {}))
        # someone writes to it: Working again
        with open(log, "a") as f:
            f.write(user(ready_at + 120_000, "Also add a logout button"))
        self.assertTrue(self.agents.busy_again(t, working))
        self.assertEqual(self.agents.task_status(t, working), ("working", None, "Working again"))

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

    def test_a_fix_withdrawn_stops_waking_it(self):
        """#1086: a fix request that no longer applies (fixed through another task; its worker told to stand down)
        is withdrawn: Ready again, no fix pending, and the tick doesn't raise the same problem at the same commit."""
        t = self.ready(mode="worktree", worktree="/w", branch="b", space="sp1",
                       pr={"number": 3, "repo": "o/r", "checked": 0, "news": {"text": "x", "at": 1, "since": 1}},
                       attention="Checks failing: check.", attention_head="a", attention_at=1)
        self.store.loc["folder"] = "/main"
        with self.mock.patch.object(self.commands, "tell", lambda s, t, msg, args: ("t1", False)):
            self.commands.cmd_fix(self.args(reason=None))
        self.assertEqual(t["state"], "running")
        self.live = [self.agent({"address": "t1", "status": "idle", "turn": 7, "role": "worker"})]
        self.commands.cmd_fix(self.args(reason=None, withdraw=True))
        self.assertEqual((t["state"], t["ready_turns"]), ("ready", {"t1": 7}))
        for k in ("back", "attention", "fix_requested", "handed_at", "progress"):
            self.assertNotIn(k, t)
        self.assertNotIn("news", t["pr"])
        self.assertEqual(self.agents.task_status(t, self.live)[0], "ready")
        # GitHub still says the same at the same commit: not raised again
        red = {"state": "OPEN", "mergeable": "MERGEABLE", "headRefOid": "a", "statusCheckRollup": [{"name": "check", "conclusion": "FAILURE"}]}
        with self.mock.patch.object(self.tick, "pr_view", lambda t: red), self.mock.patch.object(self.tick, "pr_news", lambda *a: None):
            self.tick.facts(self.store, t, {"attention": []})
            self.assertNotIn("attention", t)
            # a new commit that fails again is a new problem
            red["headRefOid"] = "b"
            t["pr"]["checked"] = 0
            self.tick.facts(self.store, t, {"attention": []})
        self.assertEqual(t["attention"], "Checks failing: check.")
        self.assertNotIn("fix_withdrawn", t)

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
                         '<herdr-news task="SHEP-7" event="working-again">"Web client" is working again: its agent is at work again</herdr-news>')

    def test_a_dead_agents_shell_is_no_agent(self):
        """#1022: a Codex worker that died mid-turn left its plain shell, hc still saying "working" (as real hc does
        after kill -9): the task stayed Working, a Ready one went back to work. Its leftover is no agent now, a fish
        running its agent (#780) still is, and resume retires the leftover terminal."""
        dead = {"address": "t1", "status": {"app": "codex", "state": "working"}, "turn": 9, "labels": {"herdr.role": "worker"},
                "agent": "bash", "foreground": {"name": "bash", "argv": ["/bin/bash", "-i"]}}
        fish = dict(dead, agent="fish", foreground={"name": "fish", "argv": ["fish", "-ic", "claude go; exec fish -i"]})
        live = dict(dead, agent="codex", foreground={"name": "codex", "argv": ["codex"]})
        self.assertEqual([k["agent"] for k in self.agents.mid_turn_agents([dead, fish, live])], ["fish", "codex"])
        # hc ls alone (no foreground): only a shell in front makes it look closer
        bare = {k: v for k, v in dead.items() if k != "foreground"}
        with self.mock.patch.object(self.agents, "detail", lambda k: dead if k["agent"] == "bash" else k):
            self.assertEqual(self.agents.mid_turn_agents([bare, {**bare, "agent": "codex"}]), [{**bare, "agent": "codex"}])
        t = self.ready(space="sp1")
        self.live = [dead]
        report = {}
        self.tick.back_pass(self.store, t, report)
        self.assertEqual(t["state"], "ready")
        self.assertNotIn("working_again", report)
        self.assertFalse(self.tick.at_work(self.store, t))
        # resume: the new agent starts, the old terminal goes
        killed = []
        self.live = [dict(dead, status=None)]
        with self.mock.patch.object(self.commands, "start_again", lambda *a, **k: ({"address": "t2"}, True)), \
                self.mock.patch.object(self.commands, "agent_running", lambda k: False), \
                self.mock.patch.object(self.commands, "stop_note", lambda *a, **k: None), \
                self.mock.patch.object(self.commands, "run", lambda args, **k: killed.append(args)):
            self.commands.cmd_resume(self.args(space=None, agent=None, argv=None, parent=None))
        self.assertEqual(killed, [["hc", "kill", "t1"]])

    def test_a_background_jobs_later_change_is_working_again(self):
        """#1108: a Ready worker's turn ended with its own background job still running and nothing changed yet: the
        turn stays unrecorded, so when the job changes the branch later the task is working again."""
        wt = tempfile.mkdtemp()
        t = self.ready(space="sp1", mode="worktree", worktree=wt, branch="b", head="a")
        heads, jobs = ["a"], [True]
        for name, value in (("git", lambda cwd, *a: (True, heads[0] if a[0] == "rev-parse" else "", "")),
                            ("own_work", lambda task, live, ready=False: jobs[0]),
                            ("last_question", lambda task, address=None: None)):
            p = self.mock.patch.object(self.tick, name, value)
            p.start()
            self.addCleanup(p.stop)
        report = {}
        self.live = [self.agent({"address": "t1", "status": "idle", "turn": 6, "role": "worker"})]
        self.tick.back_pass(self.store, t, report)
        self.assertEqual((t["state"], t["ready_turns"]), ("ready", {"t1": 5}))
        heads[0], jobs[0] = "c", False   # the job committed, then ended
        self.tick.back_pass(self.store, t, report)
        self.assertEqual((t["state"], report["working_again"]), ("running", ["SHEP-7"]))
        # a job that ends with nothing changed: its turn is recorded then
        t2 = self.ready(space="sp1", mode="worktree", worktree=wt, branch="b", head="c")
        self.tick.back_pass(self.store, t2, {})
        self.assertEqual((t2["state"], t2["ready_turns"]), ("ready", {"t1": 6}))

    def test_a_question_asked_between_two_ticks_is_heard(self):
        """#1000: GitHub news woke a Ready worker, it asked "pick one" in its own terminal and went quiet before
        any tick saw it working: the task stayed Ready and nobody heard. Its finished turn is seen now."""
        t = self.ready(space="sp1")  # said ready in turn 5 (ready_turns: the first new one)
        asked = {}
        p = self.mock.patch.object(self.tick, "last_question", lambda task, address=None: asked.get(address))
        p.start()
        self.addCleanup(p.stop)
        report = {}
        self.live = [self.agent({"address": "t1", "status": "idle", "turn": 5, "role": "worker"})]
        self.tick.back_pass(self.store, t, report)
        self.assertEqual(t["state"], "ready")  # its ready turn ended: nothing new
        # a whole turn since, nothing asked nor changed (a background job's notice): Ready, its turns moved on
        self.live = [self.agent({"address": "t1", "status": "idle", "turn": 6, "role": "worker"})]
        self.tick.back_pass(self.store, t, report)
        self.assertEqual((t["state"], t["ready_turns"]), ("ready", {"t1": 6}))
        self.assertNotIn("working_again", report)
        # the next one asks: back to work (Needs you once it stays quiet), and its Assistant hears
        asked["t1"] = "Which fix: A or B?"
        self.live = [self.agent({"address": "t1", "status": "idle", "turn": 7, "role": "worker"})]
        self.tick.back_pass(self.store, t, report)
        self.assertEqual((t["state"], report["working_again"]), ("running", ["SHEP-7"]))
        self.assertEqual(self.news.news_line(self.store, t, {}, "working-again"),
                         '<herdr-news task="SHEP-7" event="working-again">"Web client" is working again: its agent asked something</herdr-news>')
        # and the words: GitHub's news and the brief tell a woken Ready worker to ask with its question tool
        from herdr_task import ghnews, templates
        with open(os.path.join(ROOT, "templates", "worker.md")) as f:
            worker = f.read()
        for words in (templates.WORKER_MD, worker):
            self.assertIn(templates.ASK_RULE, words)
            self.assertNotIn(templates.ASK_OLD, words)
        self.assertIn(templates.WORKER_MD_BEFORE_ASK, templates.OLD_WORKERS)  # an unedited old one gets today's
        with open(ghnews.__file__) as f:
            self.assertIn("ask the person with your CLI's question tool", f.read())

    def test_targeted_tests_before_ready(self):
        """A task runs the tests for what it touched; the full suite belongs to main and the release."""
        from herdr_task import ghnews, templates
        with open(os.path.join(ROOT, "templates", "worker.md")) as f:
            worker = f.read()
        for words in (templates.WORKER_MD, worker):
            self.assertIn(templates.TESTS_RULE, words)
            self.assertNotIn(templates.TESTS_OLD, words)
            self.assertIn(templates.LIVE_RULE, words)
        self.assertIn(templates.WORKER_MD_BEFORE_TESTS, templates.OLD_WORKERS)  # an unedited old one gets today's
        with open(os.path.join(ROOT, "templates", "assistant.md")) as f:
            assistant = f.read()
        self.assertIn("never the whole suite; the full suite belongs to main", assistant)
        self.assertIn("add one small fix-forward task at once", assistant)
        with open(ghnews.__file__) as f:
            self.assertIn("add one small fix-forward task at once", f.read())

    def test_suggested_replies_hard_limit(self):
        """SHEP-463: every agent is told a suggested reply is at most 30 characters (what a phone's bubble holds, the
        web app's SUGGEST_CHARS), short but complete; an unedited old worker default gets today's."""
        from herdr_task import templates
        texts = {}
        for name in ("worker.md", "assistant.md"):
            with open(os.path.join(ROOT, "templates", name)) as f:
                texts[name] = f.read()
        for words in (templates.WORKER_MD, *texts.values()):
            self.assertIn(templates.LIMIT_RULE, words)
            self.assertNotIn("under about 40 characters", words)
            self.assertIn('never a bare "1"', words)
        self.assertIn("at most 30 characters", templates.LIMIT_RULE)
        self.assertIn(templates.WORKER_MD_BEFORE_LIMIT, templates.OLD_WORKERS)
        with open(os.path.join(ROOT, "web", "shared", "suggest.ts")) as f:
            self.assertIn("export const SUGGEST_CHARS = 30\n", f.read())

    def test_later_rounds_review_only_the_new_change(self):
        """#1116: a later review round reviews only what changed since the last reviewed commit, its reviewer splits
        must-fix from follow-up, and only must-fix findings cost a round; unedited old templates get today's."""
        from unittest import mock
        from herdr_task import templates
        with open(os.path.join(ROOT, "templates", "worker.md")) as f:
            worker = f.read()
        with open(os.path.join(ROOT, "templates", "reviewer.md")) as f:
            reviewer = f.read()
        for words in (templates.WORKER_MD, worker):
            self.assertIn(templates.DELTA_RULE, words)
            self.assertIn(templates.MUST_RULE, words)
            self.assertNotIn("the diff against the base branch and", words)
        for words in (templates.REVIEWER_MD, reviewer):
            self.assertIn(templates.REVIEWER_DELTA_RULE, words)
            self.assertIn(templates.REVIEWER_MUST_RULE, words)
            self.assertNotIn(templates.REVIEWER_DELTA_OLD, words)
        self.assertIn(templates.WORKER_MD_BEFORE_DELTA, templates.OLD_WORKERS)
        with tempfile.TemporaryDirectory() as d, mock.patch.object(templates, "TEMPLATES", d):
            with open(os.path.join(d, "reviewer.md"), "w") as f:
                f.write(templates.TEMPLATE_HEADS["reviewer"] + templates.REVIEWER_MD_BEFORE_DELTA)
            self.assertEqual(templates.instructions("reviewer"), templates.REVIEWER_MD.strip())

    # A merge that failed once (t75: "GraphQL: Something went wrong") never blocks the next Accept, and a pull
    # request merged meanwhile (by hand) makes the task done.
    def merging(self, views, merges):
        """Accept with GitHub giving these pull request views and merge results in turn."""
        views, merges = list(views), list(merges)
        done = []
        patches = [(self.commands, "pr_view", lambda t: views.pop(0)),
                   (self.commands, "gh", lambda *a, **k: merges.pop(0)),
                   (self.commands, "watch_main", lambda *a: None), (self.commands, "update_main", lambda *a: None),
                   (self.commands, "drop_branch", lambda s, t: None),
                   (self.commands, "finish", lambda s, t, even_if_busy=False: (t.update(state="done"), done.append(t["id"])))]
        for mod, name, value in patches:
            p = self.mock.patch.object(mod, name, value)
            p.start()
            self.addCleanup(p.stop)
        return done

    def pr_task(self, **more):
        return self.ready(mode="worktree", worktree="/w", branch="b", pr={"number": 593, "repo": "o/r", "checked": 5}, **more)

    def test_accept_tries_a_failed_merge_again(self):
        t = self.pr_task()
        fine = {"state": "OPEN", "mergeable": "MERGEABLE", "statusCheckRollup": [], "headRefOid": "abc"}
        self.merging([fine, fine, fine, {"state": "MERGED", "mergeCommit": {"oid": "f00"}}],
                     [(False, "", "GraphQL: Something went wrong"), (True, "", "")])
        with self.assertRaises(SystemExit):
            self.commands.cmd_accept(self.args())
        # 3.2: a failed merge is its agent's to fix; here none could be told, so it needs the person, saying why
        self.assertEqual(t["state"], "ready")
        self.assertTrue(t["attention"].startswith("GitHub didn't merge it: GraphQL: Something went wrong (and its agent couldn't be told"), t["attention"])
        self.assertEqual(t["merge_failed"], "GitHub didn't merge it: GraphQL: Something went wrong")
        self.assertEqual(t["pr"]["checked"], 0)  # the next tick reads it at once
        self.commands.cmd_accept(self.args())
        self.assertEqual((t["state"], t.get("merged")), ("done", True))

    def test_a_merge_right_away_that_fails_is_its_agents_to_fix(self):
        """Merge: right away. The agent saying ready hears at once that the merge failed, and the task stays Working."""
        t = self.pr_task()
        t.update(state="running", worktree=tempfile.mkdtemp())
        t["pr"]["url"] = "https://github.example/o/r/pull/593"
        with self.mock.patch.object(self.commands, "github", lambda s: "o/r"), \
                self.mock.patch.object(self.commands, "pr_open", lambda s, task, repo, summary: task["pr"]), \
                self.mock.patch.object(self.commands, "merge_policy", lambda s, task: "auto"), \
                self.mock.patch.object(self.commands, "merge_now", lambda s, task, accept=False: "It conflicts with main."):
            msg = self.commands.finalize(self.store, t)
        self.assertIn("is ready, but: merging it failed: It conflicts with main.", msg)
        self.assertEqual((t["state"], t["merge_failed"]), ("running", "It conflicts with main."))
        # checks still running is no failure: it waits, Ready
        t.pop("merge_failed")
        with self.mock.patch.object(self.commands, "github", lambda s: "o/r"), \
                self.mock.patch.object(self.commands, "pr_open", lambda s, task, repo, summary: task["pr"]), \
                self.mock.patch.object(self.commands, "merge_policy", lambda s, task: "auto"), \
                self.mock.patch.object(self.commands, "merge_now", lambda s, task, accept=False: self.commands.CHECKS_RUNNING):
            msg = self.commands.finalize(self.store, t)
        self.assertIn("Merging it waits: Checks are still running.", msg)
        self.assertEqual((t["state"], t.get("merge_failed")), ("ready", None))
        self.assertFalse(self.commands.merge_waits("GitHub didn't merge it: nope"))
        self.assertTrue(self.commands.merge_waits("Couldn't reach pull request #5 on GitHub."))

    def test_a_failed_merge_goes_back_to_its_agent(self):
        """3.2 (step 37): a merge that fails is fixed by the agent itself: Working again, merge_failed says why in one
        line, its agent is told and asked to hand it in again; the next ready clears it."""
        t = self.pr_task()
        conflict = {"state": "OPEN", "mergeable": "CONFLICTING", "statusCheckRollup": [], "headRefOid": "abc"}
        self.merging([conflict], [])
        told = []
        with self.mock.patch.object(self.commands, "tell", lambda s, task, msg, args: (told.append(msg), ("t9", False))[1]), \
                self.assertRaises(SystemExit):
            self.commands.cmd_accept(self.args())
        self.assertEqual(t["state"], "running")
        self.assertTrue(t["merge_failed"].startswith("It conflicts"), t["merge_failed"])
        self.assertNotIn("attention", t)
        self.assertNotIn("accepted_at", t)
        self.assertIn("couldn't be merged: It conflicts", told[0])
        self.assertIn("herdr-task ready", told[0])
        self.assertEqual(t["progress"]["text"][:7], "Fixing:")

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

    # GitHub's merge queue (#742, #801, #802, #1045): the pull request joins the queue and the task stays
    # Merging until GitHub merged it, then its branch there goes. gh is never asked to delete the branch:
    # when it doesn't know about the queue it deletes it right after queueing, which closes the pull request.
    FINE = {"state": "OPEN", "mergeable": "MERGEABLE", "statusCheckRollup": [{"name": "test", "status": "COMPLETED", "conclusion": "SUCCESS"}],
            "headRefOid": "abc"}

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
        # gh that doesn't know the base has a queue (#1045): its merge call only queues it
        calls, done, dropped = self.gh_merges([self.FINE, self.FINE], [(True, "", "")])
        self.commands.cmd_accept(self.args())
        self.assertEqual(len(calls), 1)
        self.assertNotIn("--delete-branch", calls[0])
        self.assertEqual(calls[0][calls[0].index("--match-head-commit") + 1], "abc")
        self.assertEqual((t["state"], bool(t.get("merged")), done, dropped), ("ready", False, [], []))
        self.assertTrue(t["merge_queued"])
        self.assertNotIn("attention", t)
        self.assertEqual(self.agents.task_status(t, []), ("working", None, "In GitHub's merge queue"))

    def test_merge_again_while_queued_asks_github_nothing_more(self):
        t = self.pr_task()
        t["merge_queued"] = 1
        calls, done, _ = self.gh_merges([self.FINE], [])
        self.commands.cmd_merge(self.args())
        self.assertEqual((calls, done, t["state"]), ([], [], "ready"))

    def test_a_repo_without_a_queue_merges_then_drops_its_branch(self):
        t = self.pr_task()
        calls, done, dropped = self.gh_merges([self.FINE, {"state": "MERGED", "mergeCommit": {"oid": "f00"}}], [(True, "", "")])
        self.commands.cmd_accept(self.args())
        self.assertEqual(len(calls), 1)
        self.assertNotIn("--delete-branch", calls[0])
        self.assertEqual((t["state"], t.get("merged"), dropped), ("done", True, [7]))

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

    # #1044, #1018: "merge after checks" never merges a pull request whose checks haven't started yet.
    def early_tick(self, v, clock, expect):
        """One tick pass at clock (ms) with its repo's workflows saying expect (expected_checks())."""
        import herdr_task.github as github
        merged = []
        for mod, name, value in ((github, "now", lambda: clock), (self.tick, "expected_checks", lambda s, t, sha: expect),
                                 (self.tick, "merge_now", lambda s, t: merged.append(t["id"]) or None)):
            p = self.mock.patch.object(mod, name, value, create=True)
            p.start()
            self.addCleanup(p.stop)
        self.queue_tick(v, clock=clock)
        t = self.store.data["tasks"][0]
        fresh = t.get("_pr_fresh")
        if t["state"] == "ready" and t.get("auto_merge") and t.get("pr") and not t.get("attention") and fresh:
            merged.append(t["id"])
        return fresh, merged

    NONE_YET = {"state": "OPEN", "mergeable": "MERGEABLE", "statusCheckRollup": [], "headRefOid": "abc", "mergeStateStatus": "CLEAN"}

    def test_no_checks_yet_with_a_workflow_never_merges(self):
        t = self.pr_task(auto_merge="checks", ready_at=1_000_000)
        # 40 s after ready, no check shown yet: before, "none for 30 s" read as "none set up" and it merged
        fresh, merged = self.early_tick(self.NONE_YET, 1_040_000, "yes")
        self.assertEqual((fresh, merged, t["pr"].get("wait")), (False, [], "Checks running"))
        self.assertEqual(self.agents.task_status(t, [])[0], "working")
        # its checks start and pass: it merges then
        ran = dict(self.NONE_YET, statusCheckRollup=[{"name": "test", "status": "COMPLETED", "conclusion": "SUCCESS"}])
        fresh, merged = self.early_tick(ran, 1_100_000, "yes")
        self.assertEqual((fresh, merged), (True, [7]))

    def test_a_repo_without_workflows_still_merges_after_a_moment(self):
        t = self.pr_task(auto_merge="checks", ready_at=1_000_000)
        self.assertEqual(self.early_tick(self.NONE_YET, 1_010_000, None), (False, []))
        self.assertEqual(self.early_tick(self.NONE_YET, 1_040_000, None), (True, [7]))
        self.assertNotIn("wait", t["pr"])

    def test_a_filtered_workflow_waits_longer_then_merges(self):
        self.pr_task(auto_merge="checks", ready_at=1_000_000)
        self.assertEqual(self.early_tick(self.NONE_YET, 1_000_000 + 4 * 60000, "maybe"), (False, []))
        self.assertEqual(self.early_tick(self.NONE_YET, 1_000_000 + 6 * 60000, "maybe"), (True, [7]))

    def test_a_required_check_github_blocks_on_waits_too(self):
        self.pr_task(auto_merge="checks", ready_at=1_000_000)
        self.assertEqual(self.early_tick(dict(self.NONE_YET, mergeStateStatus="BLOCKED"), 1_000_000 + 5 * 60000, None), (False, []))

    def test_checks_that_never_start_need_you_and_never_merge(self):
        t = self.pr_task(auto_merge="checks", ready_at=1_000_000)
        fresh, merged = self.early_tick(self.NONE_YET, 1_000_000 + 25 * 60000, "yes")
        self.assertEqual((fresh, merged, t.get("attention")), (False, [], self.tick.CHECKS_NEVER))
        # they start at last: the note goes
        ran = dict(self.NONE_YET, statusCheckRollup=[{"name": "test", "status": "IN_PROGRESS", "conclusion": ""}])
        self.early_tick(ran, 1_000_000 + 26 * 60000, "yes")
        self.assertNotIn("attention", t)

    def test_a_new_commit_after_ready_waits_for_its_own_checks(self):
        t = self.pr_task(auto_merge="checks", ready_at=1_000_000)
        old = dict(self.NONE_YET, statusCheckRollup=[{"name": "test", "status": "IN_PROGRESS", "conclusion": ""}])
        self.early_tick(old, 1_010_000, "yes")
        self.assertEqual(t["pr"]["head_sha"], "abc")
        # #1018: a push 10 minutes after ready; GitHub shows no checks for the new head yet
        fresh, merged = self.early_tick(dict(self.NONE_YET, headRefOid="def"), 1_600_000, "yes")
        self.assertEqual((fresh, merged, t["pr"]["head_at"]), (False, [], 1_600_000))

    def test_a_workflow_run_not_finished_is_checks_running(self):
        import herdr_task.github as github
        done = {"state": "OPEN", "statusCheckRollup": [{"name": "quick", "status": "COMPLETED", "conclusion": "SUCCESS"}]}
        self.assertFalse(github.pr_pending(done))
        # a job that waits on another's needs isn't a check yet, but its run isn't finished
        self.assertTrue(github.pr_pending(dict(done, runs_pending=True)))

    def test_its_checks_in_one_word_for_its_row(self):
        # SHEP-348: the mark on a task row's repo line: running, failed, passed, or none
        import herdr_task.github as github
        row = lambda st, c="": {"name": "test", "status": st, "conclusion": c}
        self.assertEqual(github.checks_state({"statusCheckRollup": [row("COMPLETED", "SUCCESS"), row("COMPLETED", "FAILURE")]}), "failed")
        self.assertEqual(github.checks_state({"statusCheckRollup": [row("COMPLETED", "SUCCESS"), row("IN_PROGRESS")]}), "running")
        self.assertEqual(github.checks_state({"statusCheckRollup": [row("COMPLETED", "SUCCESS"), row("COMPLETED", "SKIPPED")]}), "passed")
        self.assertEqual(github.checks_state({"statusCheckRollup": [row("COMPLETED", "SUCCESS")], "runs_pending": True}), "running")
        self.assertEqual(github.checks_state({"statusCheckRollup": []}, missing=True), "running")
        self.assertIsNone(github.checks_state({"statusCheckRollup": []}))

    def test_a_tick_keeps_its_checks_word_on_its_pull_request(self):
        t = self.pr_task(ready_at=1_000_000)
        running = dict(self.NONE_YET, statusCheckRollup=[{"name": "test", "status": "IN_PROGRESS", "conclusion": ""}])
        self.early_tick(running, 1_010_000, "yes")
        self.assertEqual(t["pr"]["checks"], "running")
        passed = dict(self.NONE_YET, statusCheckRollup=[{"name": "test", "status": "COMPLETED", "conclusion": "SUCCESS"}])
        self.early_tick(passed, 1_200_000, "yes")
        self.assertEqual(t["pr"]["checks"], "passed")

    def test_accept_before_checks_start_merges_once_they_pass(self):
        import herdr_task.github as github
        t = self.pr_task(ready_at=1_000_000)
        calls, done, _ = self.gh_merges([self.NONE_YET], [])
        for mod, name, value in ((github, "now", lambda: 1_040_000), (self.commands, "expected_checks", lambda s, t, sha: "yes")):
            p = self.mock.patch.object(mod, name, value, create=True)
            p.start()
            self.addCleanup(p.stop)
        self.commands.cmd_accept(self.args())
        self.assertEqual((calls, done, t["state"], t.get("auto_merge")), ([], [], "ready", "checks"))

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
        t.pop("ready_at", None)  # it never said ready: the merge was a fix on the way (#844)
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

    def test_ready_again_edits_one_comment_never_a_second(self):
        """#1058: each ready posted the summary again; now one comment, edited when the summary changes."""
        import herdr_task.github as github
        calls = []

        def fake(*a, **k):
            calls.append(a)
            if a[:2] == ("pr", "view"):
                return True, "OPEN", ""
            if a[:2] == ("pr", "comment"):
                return True, "https://github.com/o/r/pull/599#issuecomment-4242", ""
            return True, "", ""
        with self.mock.patch.object(github, "gh", fake), self.mock.patch.object(github, "git", lambda *a: (True, "abc", "")):
            t = self.ready(mode="worktree", worktree="/w", branch="b", pr={"number": 599, "url": "u", "repo": "o/r"})
            for summary in ("Done.", "Done.", "Done.", "Done, and the findings fixed."):
                github.pr_open(self.store, t, "o/r", summary)
        posts = [c for c in calls if c[:2] == ("pr", "comment")]
        edits = [c for c in calls if c[:1] == ("api",)]
        self.assertEqual(len(posts), 1, "a second comment for the same pull request")
        self.assertEqual(len(edits), 1)
        self.assertIn("repos/o/r/issues/comments/4242", edits[0])
        self.assertIn("body=Done, and the findings fixed.", edits[0])
        self.assertEqual(t["pr_note"], {"number": 599, "id": 4242, "said": "Done, and the findings fixed."})

    def test_a_new_pull_request_says_it_in_its_body_only(self):
        import herdr_task.github as github
        calls = []

        def fake(*a, **k):
            calls.append(a)
            if a[:2] == ("pr", "list"):
                return True, "[]", ""
            if a[:2] == ("pr", "create"):
                return True, "https://github.com/o/r/pull/600", ""
            return True, "", ""
        with self.mock.patch.object(github, "gh", fake), self.mock.patch.object(github, "git", lambda *a: (True, "abc", "")):
            t = self.ready(mode="worktree", worktree="/w", branch="b")
            github.pr_open(self.store, t, "o/r", "Done.")
            calls.append(("pr", "view"))  # (now it's open)
            with self.mock.patch.object(github, "gh", lambda *a, **k: (calls.append(a), (True, "OPEN", ""))[1]):
                github.pr_open(self.store, t, "o/r", "Done.")
        self.assertNotIn(("pr", "comment"), [c[:2] for c in calls])

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

    def test_a_failed_push_says_what_its_hook_said(self):
        """#963: a pre-push hook's own words (what failed, where its log is) went to stdout, and ready showed only
        git's "failed to push some refs". A real repo and remote, gh faked."""
        import herdr_task.github as github
        d = tempfile.mkdtemp()
        subprocess.run(["git", "init", "-q", "--bare", os.path.join(d, "remote.git")], check=True)
        wt = os.path.join(d, "wt")
        subprocess.run(["git", "init", "-q", "-b", "main", wt], check=True)
        for c in (["remote", "add", "origin", os.path.join(d, "remote.git")],
                  ["-c", "user.email=a@example.com", "-c", "user.name=a", "commit", "-q", "--allow-empty", "-m", "x"],
                  ["checkout", "-q", "-b", "b"]):
            subprocess.run(["git", "-C", wt, *c], check=True)
        hook = os.path.join(wt, ".git", "hooks", "pre-push")
        with open(hook, "w") as f:
            f.write('#!/bin/sh\necho "typecheck: 3 errors in src/app.ts"\necho "full log: /tmp/typecheck.log" >&2\nexit 1\n')
        os.chmod(hook, 0o755)
        t = self.ready(mode="worktree", worktree=wt, branch="b")
        with self.mock.patch.object(github, "gh", lambda *a, **k: (False, "", "")), \
                self.mock.patch.dict(self.store.loc, {"folder": wt}):
            with self.assertRaises(self.commands.Fail) as e:
                github.pr_open(self.store, t, "o/r")
        said = str(e.exception)
        self.assertIn("typecheck: 3 errors in src/app.ts", said)
        self.assertIn("full log: /tmp/typecheck.log", said)
        self.assertIn("failed to push some refs", said)
        self.assertEqual(github.push_error("\n".join(map(str, range(30))), ""), "\n".join(map(str, range(15, 30))))

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

    def monitor(self, ago, job="m1", timeout=900000, persistent=False):
        self.stamp(ago, {"type": "user", "toolUseResult": {"taskId": job, "timeoutMs": timeout, "persistent": persistent},
                         "message": {"role": "user", "content": [{"tool_use_id": "toolu_2", "type": "tool_result",
                                                                  "content": f"Monitor started (task {job}, expires in 15m)"}]}})

    def test_an_expired_monitor_no_longer_runs(self):
        """#1270: a Monitor's expiry notice has no <status>, and one may expire unannounced; either way
        it no longer counts once its own timeout has passed (as Claude Code 2.1.323 logs it)."""
        self.say(-1_200_000, "Watching CI.")
        self.monitor(-1_300_000)
        self.stamp(-200_000, {"type": "queue-operation", "operation": "enqueue", "content":
                              "<task-notification>\n<task-id>m1</task-id>\n<summary>Monitor event: \"CI\"</summary>\n"
                              "<event>[Monitor expired after 15m with no events delivered. Re-arm it if you still need the watch.]</event>\n"
                              "</task-notification>"})
        self.assertEqual(self.agents.background_jobs(self.log)[0], {})
        self.assertEqual(self.status()[:2], ("needs", "reply"))
        # no notice at all: gone once its timeout has passed, running until then
        self.lines[:] = self.lines[:2]
        self.monitor(-1_000_000)
        self.assertEqual(self.agents.background_jobs(self.log)[0], {})
        self.lines[:] = self.lines[:2]
        self.monitor(-600_000)
        self.assertEqual(list(self.agents.background_jobs(self.log)[0]), ["m1"])
        # a persistent one has no timeout of its own
        self.lines[:] = self.lines[:2]
        self.monitor(-1_000_000, persistent=True)
        self.assertEqual(list(self.agents.background_jobs(self.log)[0]), ["m1"])
        # another Monitor's event (not its expiry) ends nothing
        self.lines[:] = self.lines[:2]
        self.monitor(-600_000)
        self.stamp(-100_000, {"type": "queue-operation", "operation": "enqueue", "content":
                              "<task-notification>\n<task-id>m1</task-id>\n<summary>Monitor event</summary>\n"
                              "<event>build 3 passed</event>\n</task-notification>"})
        self.assertEqual(list(self.agents.background_jobs(self.log)[0]), ["m1"])

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

    def test_its_status_line_says_so_in_another_language(self):
        """#1259: a status line in Chinese (or another language) that waits on GitHub's checks is Working too;
        one that waits on the person still Needs you."""
        self.say(-200_000, "Pushed.")
        for text, want in (("等待 GitHub 檢查完成", "working"), ("CI 檢查執行中，等待結果", "working"), ("CIの完了待ち", "working"),
                           ("CI 검사 대기 중", "working"), ("Esperando a CI", "working"), ("Warte auf die Checks", "working"),
                           ("Жду проверки CI", "working"), ("等待本人批准合併", "needs"), ("レビューの承認待ち", "needs"),
                           ("Esperando tu aprobación", "needs"), ("修好了選單", "needs"), ("等待結果", "needs")):
            self.task["progress"] = {"text": text, "set": self.clock - 120_000, "at": self.clock - 120_000}
            self.assertEqual(self.status()[0], want, text)

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


class CodexCodeMode(unittest.TestCase):
    """SHEP-207: Codex 0.163+ code mode runs its commands from a script (one exec call with
    tools.exec_command and tools.write_stdin inside Promise.allSettled). A poll's result drops its
    session id once the command exited, so each result is matched to the session its call polled,
    and a Codex job counts only while its agent's process tree runs something besides the code-mode
    host. The items are a real run's (fixtures/codex-code-mode); the process tree is faked (ps)."""

    setUp = OwnBackgroundWork.setUp
    stamp, status = OwnBackgroundWork.stamp, OwnBackgroundWork.status

    def setUp_ps(self, ps=""):
        """The `ps` output codex_working() reads (the rest of the test's processes: none). Each line "pid ppid
        [+seconds] args", as ps writes it with its start time (lstart): the agent (ppid 1) at 10:00:00, the
        others a minute later unless +seconds says when."""
        from types import SimpleNamespace
        if not hasattr(self, "ps"):
            p = self.mock.patch.object(self.agents, "run", lambda args, **kw: SimpleNamespace(stdout=self.ps), create=True)
            p.start()
            self.addCleanup(p.stop)
        rows = []
        for line in ps.splitlines():
            pid, ppid, rest = line.split(None, 2)
            m = re.match(r"\+(\d+) (.*)", rest)
            after, args = (int(m.group(1)), m.group(2)) if m else (0 if ppid == "1" else 60, rest)
            rows.append(f"{pid} {ppid} Sun Nov 15 10:{after // 60:02d}:{after % 60:02d} 2026 {args}")
        self.ps = "\n".join(rows) + "\n"

    def replay(self, n=None):
        with open(os.path.join(ROOT, "test", "fixtures", "codex-code-mode", "rollout-items.jsonl")) as f:
            items = [json.loads(line) for line in f if line.strip()]
        for i, item in enumerate(items[:n]):
            self.stamp(-300_000 + i * 1000, item)

    def codex(self, ps_pid=100):
        return [{"address": "t1", "status": {"state": "idle"}, "labels": {"herdr.role": "worker"},
                 "foreground": {"pid": ps_pid, "name": "codex"}}]

    def test_each_poll_ends_its_own_session(self):
        self.setUp_ps()
        self.replay(2)  # both commands started: their results carry their session ids
        self.assertEqual(sorted(self.agents.background_jobs(self.log)[0]), ["codex:50495", "codex:69674"])
        self.replay(4)  # the script polls both in one call: "Script running with cell ID 2"
        self.assertEqual(sorted(self.agents.background_jobs(self.log)[0]), ["codex:50495", "codex:69674"])
        self.replay()  # wait on cell 2: alpha's result has no session id (exited), beta still runs
        jobs, ended = self.agents.background_jobs(self.log)
        self.assertEqual(list(jobs), ["codex:50495"])
        self.assertGreater(ended, 0)

    def test_a_result_without_its_id_ends_the_session_its_place_polled(self):
        self.setUp_ps()
        self.stamp(-300_000, {"type": "response_item", "payload": {"type": "custom_tool_call", "call_id": "p1", "name": "exec",
                              "input": "await Promise.allSettled([tools.write_stdin({session_id:7, chars:''}), tools.write_stdin({session_id:8, chars:''})])"}})
        self.stamp(-299_000, {"type": "response_item", "payload": {"type": "function_call_output", "call_id": "p1", "output": [
            {"type": "input_text", "text": "[{\"status\":\"fulfilled\",\"value\":{\"exit_code\":0,\"output\":\"\"}},"
                                         "{\"status\":\"fulfilled\",\"value\":{\"session_id\":8,\"output\":\"\"}}]"}]}})
        self.assertEqual(list(self.agents.background_jobs(self.log)[0]), ["codex:8"])

    def test_a_code_mode_job_with_no_process_is_over(self):
        """The bug: the log still counts beta, but its agent is idle and no command runs under it."""
        self.setUp_ps("100 1 codex --no-daemon\n101 100 /usr/local/lib/codex/codex-code-mode-host\n")
        self.replay(4)
        live = self.codex()
        self.assertEqual(self.status(live)[:2], ("needs", "reply"))
        self.assertFalse(self.agents.own_work(self.task, live, ready=True))

    def test_a_running_command_under_the_agent_is_still_work(self):
        self.setUp_ps("100 1 codex --no-daemon\n101 100 /usr/local/lib/codex/codex-code-mode-host\n"
                      "102 101 /bin/bash -lc sleep 60\n")
        self.replay(4)
        live = self.codex()
        self.assertEqual(self.status(live)[:2], ("working", None))
        self.assertTrue(self.agents.own_work(self.task, live, ready=True))

    def test_an_agent_without_a_pid_keeps_the_log_s_word(self):
        self.setUp_ps()
        self.replay(4)
        self.assertEqual(self.status()[:2], ("working", None))

    def test_the_old_write_stdin_format_still_ends(self):
        self.setUp_ps()
        self.stamp(-300_000, {"type": "response_item", "payload": {"type": "function_call", "call_id": "c1", "name": "exec_command",
                              "arguments": json.dumps({"cmd": "gh run watch"})}})
        self.stamp(-300_000, {"type": "response_item", "payload": {"type": "function_call_output", "call_id": "c1",
                              "output": "Process running with session ID 42"}})
        self.stamp(-200_000, {"type": "response_item", "payload": {"type": "function_call", "call_id": "c2", "name": "write_stdin",
                              "arguments": json.dumps({"session_id": 42, "chars": ""})}})
        self.stamp(-100_000, {"type": "response_item", "payload": {"type": "function_call_output", "call_id": "c2",
                              "output": "Process exited with code 0\nOutput:\nok"}})
        self.assertEqual(self.agents.background_jobs(self.log)[0], {})

    def test_real_grouped_polls_clear_finished_jobs(self):
        """SHEP-218: trimmed real log, including a variable loop and mixed exec/poll results."""
        fixture = os.path.join(ROOT, "test", "fixtures", "codex-code-mode", "grouped-polls.jsonl")
        with open(fixture) as f:
            for i, line in enumerate(f):
                self.stamp(-300_000 + i * 1000, json.loads(line))
        self.assertEqual(self.agents.background_jobs(self.log)[0], {})
        self.task["state"] = "ready"
        self.setUp_ps("100 1 codex\n101 100 codex-code-mode-host\n")
        self.assertEqual(self.status(self.codex())[0], "ready")

    def test_a_one_call_batch_loop_ends_both_sessions(self):
        """#1108: `for (const sid of [7, 8]) { results.push(await tools.write_stdin(...)); }`, a body with no block of
        its own, is written out per session like the try-block form: both exited polls end their sessions."""
        call = ('const results = []; for (const sid of [7, 8]) { results.push(await tools.write_stdin({session_id: sid, '
                'chars: "}"})); } text(JSON.stringify(results));')
        slots = self.agents._codex_polled(call)
        self.assertEqual(slots, ["7", "8"])
        running = {"codex:7": 1, "codex:8": 1}
        self.agents._codex_output([{"text": json.dumps([{"exit_code": 0, "output": ""}, {"exit_code": 0, "output": ""}])}],
                                  slots, {}, running, 2)
        self.assertEqual(running, {})

    def test_mixed_commands_do_not_end_the_wrong_poll(self):
        running = {"codex:7": 1, "codex:8": 1}
        call = "text(await tools.exec_command({cmd:'true'})); text(await tools.write_stdin({session_id:7}));"
        slots = self.agents._codex_polled(call)
        self.assertEqual(slots, [None, "7"])
        self.agents._codex_output([
            {"text": json.dumps({"exit_code": 0, "output": ""})},
            {"text": json.dumps({"session_id": 7, "exit_code": None, "output": ""})}
        ], slots, {}, running, 2)
        self.assertEqual(sorted(running), ["codex:7", "codex:8"])

    def test_stdout_examples_and_ambiguous_polls_are_not_completion(self):
        running = {"codex:7": 1}
        self.agents._codex_output([{"text": json.dumps({"exit_code": 0, "output":
            'Process running with session ID 99; {"session_id":7,"exit_code":0}'})}],
            [None], {}, running, 2)
        self.assertEqual(running, {"codex:7": 1})
        # Arbitrary expressions are not evaluated or guessed.
        slots = self.agents._codex_polled("text(await tools.write_stdin({session_id:load('id')}));")
        self.agents._codex_output([{"text": '{"exit_code":0}'}], slots, {}, running, 2)
        self.assertEqual(running, {"codex:7": 1})

    def test_partial_and_rejected_batch_keeps_running_jobs(self):
        running = {"codex:7": 1, "codex:8": 1}
        self.agents._codex_output([{"text": '[{"status":"rejected","reason":"timeout"},'
            '{"status":"fulfilled","value":{"exit_code":0}}]'}], ["7", "8"], {}, running, 2)
        self.assertEqual(running, {"codex:7": 1})
        self.agents._codex_output([{"text": '{"exit_code":0}'}], ["7", "8"], {}, running, 2)
        self.assertEqual(running, {"codex:7": 1})
        self.assertEqual(self.agents._codex_polled("tools.write_stdin({session_id:7+1})"), [None])

    def test_codex_working_reads_the_process_tree(self):
        codex = {"foreground": {"pid": 100}}
        self.setUp_ps("100 1 codex\n101 100 codex-code-mode-host\n")
        self.assertFalse(self.agents.codex_working(codex))
        self.setUp_ps("100 1 codex\n101 100 codex-code-mode-host\n102 101 sleep 9\n")
        self.assertTrue(self.agents.codex_working(codex))
        self.assertTrue(self.agents.codex_working({}))  # no pid: its log decides

    def test_its_tool_servers_are_no_job(self):
        """#946/#1022: a Codex worker's MCP servers (its children since it started, as real Codex 0.163 starts
        them) kept finished jobs counting: the task stayed Working after ready. A command it started later still
        counts, and so does one under its code-mode host; a helper an MCP server starts later is the server's."""
        codex = {"foreground": {"pid": 100}}
        self.setUp_ps("100 1 codex --no-daemon\n101 100 +1 python3 tiny_mcp.py\n102 100 +4 codex-code-mode-host\n"
                      "103 101 +300 chrome --headless\n")
        self.assertFalse(self.agents.codex_working(codex))
        self.setUp_ps("100 1 codex --no-daemon\n101 100 +1 python3 tiny_mcp.py\n104 100 +83 sleep 400\n")
        self.assertTrue(self.agents.codex_working(codex))
        self.setUp_ps("100 1 codex --no-daemon\n101 100 +1 python3 tiny_mcp.py\n102 100 +4 codex-code-mode-host\n"
                      "105 102 +90 /bin/bash -lc sleep 60\n")
        self.assertTrue(self.agents.codex_working(codex))
        # its log still says a session is open, but only its tool servers run: over, the task Ready
        self.setUp_ps("100 1 codex --no-daemon\n101 100 +1 python3 tiny_mcp.py\n102 100 +4 codex-code-mode-host\n")
        self.replay(4)
        live = self.codex()
        self.assertFalse(self.agents.own_work(self.task, live, ready=True))


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
        held = {}  # #995: the card's request herdr-task reads, as the scheduler keeps it on the task (held_ask)
        with self.mock.patch.object(self.agents, "now", lambda: g["now"]), \
                self.mock.patch.object(self.agents, "held_ask", lambda address: held.get(address)):
            for i, c in enumerate(g["cases"]):
                task = dict(c["task"], id=7)
                held.clear()
                if task.get("held_ask"):
                    held[task["held_ask"]] = {"tool_name": "AskUserQuestion", "tool_input": {}}
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

    def test_a_question_on_the_card_needs_you_while_it_reads_working(self):
        """#995: a worker sat on its AskUserQuestion card, the task Working (needs None) and then stalled. The card's
        request (ask-hook.sh's file) makes it Needs you, with the question as its reason; one a killed hook left
        behind, older than the hook's 30 minutes, doesn't."""
        req = os.path.join(self.agents.HOME, ".config", "herdr-app", "data", "chat-asks", "req")
        os.makedirs(req, exist_ok=True)
        self.addCleanup(lambda: [os.remove(os.path.join(req, n)) for n in os.listdir(req)])
        p = os.path.join(req, f"t1.1799999000.{os.getpid()}.json")  # its hook: a live process
        with open(p, "w") as f:
            json.dump({"tool_name": "AskUserQuestion", "tool_input": {"questions": [{"question": "Scope or green?"}]}}, f)
        working = [dict(self.idle[0], status={"state": "working"})]
        os.utime(p, (self.clock / 1000 - 60, self.clock / 1000 - 60))
        self.assertEqual(self.status(working)[:2], ("needs", "asks"))
        self.assertTrue(self.agents.asking(working[0]))
        self.assertEqual(self.agents.ask_reason(self.task, "t1", self.agents.held_ask("t1")), "Scope or green?")
        os.utime(p, (self.clock / 1000 - 32 * 60, self.clock / 1000 - 32 * 60))
        self.assertEqual(self.status(working), ("working", None, None))

    def held(self, req, hook_pid=None, ago_s=60):
        d = os.path.join(self.agents.HOME, ".config", "herdr-app", "data", "chat-asks", "req")
        os.makedirs(d, exist_ok=True)
        self.addCleanup(lambda: [os.remove(os.path.join(d, n)) for n in os.listdir(d)])
        p = os.path.join(d, f"t1.1799999000.{hook_pid or os.getpid()}.json")
        with open(p, "w") as f:
            json.dump(req, f)
        os.utime(p, (self.clock / 1000 - ago_s, self.clock / 1000 - ago_s))
        return self.clock - ago_s * 1000

    def codex_log(self, rows):
        log = os.path.join(tempfile.mkdtemp(), "rollout.jsonl")
        with open(log, "w") as f:
            for at, typ, payload in rows:
                stamp = datetime.datetime.fromtimestamp(at / 1000, datetime.timezone.utc).isoformat().replace("+00:00", "Z")
                f.write(json.dumps({"timestamp": stamp, "type": typ, "payload": payload}) + "\n")
        return log

    def test_a_cancelled_codex_approval_is_not_needs_you(self):
        """#1077 #1097 #1139 #1140 #1144: a Codex approval cancelled (its hook killed, or its call's cell ended and the
        agent went on) kept the task at Needs you, after ready too. Only a live hook its agent still waits on holds."""
        working = [dict(self.idle[0], status={"state": "working"})]
        ask = {"tool_name": "Bash", "tool_input": {"command": "python3 scripts/check.py"}, "turn_id": "u1"}
        # the hook was killed with its call: its request left behind holds nothing
        dead = subprocess.Popen(["true"])
        dead.wait()
        self.held(ask, hook_pid=dead.pid)
        self.assertIsNone(self.agents.held_ask("t1"))
        self.assertEqual(self.status(working), ("working", None, None))

    def test_a_codex_approval_its_agent_went_past_is_not_needs_you(self):
        working = [dict(self.idle[0], status={"state": "working"})]
        at = self.clock - 60_000
        asked = [(at - 1000, "response_item", {"type": "function_call", "name": "exec_command", "call_id": "c1"}),
                 (at + 4000, "response_item", {"type": "function_call", "name": "exec_command", "call_id": "c2"}),  # same batch, streamed late
                 (at + 5000, "event_msg", {"type": "token_count"})]
        log = self.codex_log(asked)
        self.held({"tool_name": "Bash", "tool_input": {"command": "x"}, "turn_id": "u1", "transcript_path": log})
        # still waiting: the rest of its own batch came in after it, nothing new since
        self.assertEqual(self.status(working)[:2], ("needs", "asks"))
        # its model answered again (the call's cell ended without it): it went on
        log = self.codex_log(asked + [(at + 9000, "response_item", {"type": "message", "role": "assistant", "content": []})])
        self.held({"tool_name": "Bash", "tool_input": {"command": "x"}, "turn_id": "u1", "transcript_path": log})
        self.assertEqual(self.status(working), ("working", None, None))
        # its turn was interrupted
        log = self.codex_log(asked[:1] + [(at + 9000, "event_msg", {"type": "turn_aborted", "turn_id": "u1"})])
        self.held({"tool_name": "Bash", "tool_input": {"command": "x"}, "turn_id": "u1", "transcript_path": log})
        self.assertIsNone(self.agents.held_ask("t1"))

    def test_a_claude_permission_its_agent_went_past_is_not_held(self):
        log = os.path.join(tempfile.mkdtemp(), "s.jsonl")
        use = {"type": "tool_use", "id": "u1", "name": "Bash", "input": {"command": "ls"}}
        row = lambda typ, mid, content: json.dumps({"type": typ, "isSidechain": False, "message": {"id": mid, "role": typ, "content": content}})
        with open(log, "w") as f:
            f.write(row("assistant", "m1", [use]) + "\n")
        ask = {"tool_name": "Bash", "tool_input": {"command": "ls"}, "transcript_path": log}
        self.held(ask)
        self.assertEqual(self.agents.held_ask("t1"), ask)
        with open(log, "a") as f:
            f.write(row("user", None, [{"type": "tool_result", "tool_use_id": "u1", "is_error": True, "content": "interrupted"}]) + "\n")
        self.assertIsNone(self.agents.held_ask("t1"))
        # the same call tried again: asked anew, held
        with open(log, "a") as f:
            f.write(row("assistant", "m2", [dict(use, id="u2")]) + "\n")
        self.assertEqual(self.agents.held_ask("t1"), ask)

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
        self.assertEqual(self.status()[:2], ("needs", "asks"))  # #995: a permission held on the card asks
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
                                 (github, "detail", lambda k: k),
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

    def test_a_package_json_above_doesnt_reach_the_worktree(self):
        """#1132: Shepherdr's own package.json (type: module) sits above its worktrees folder; a repo with none of
        its own ran as ESM there, so its require() (tests, git hooks) failed. A plain one at the root stops Node."""
        import shutil
        wt = os.path.join(self.root, "wt")
        self.assertFalse(os.path.exists(os.path.join(wt, "package.json")))   # nothing above yet: nothing written
        _, first = self.new_worktree()
        self.assertFalse(os.path.exists(os.path.join(wt, "package.json")))
        with open(os.path.join(self.root, "package.json"), "w") as f:
            f.write('{"type": "module"}')
        _, path = self.new_worktree()
        with open(os.path.join(path, "hook.js"), "w") as f:
            f.write("const fs = require('fs'); console.log(typeof fs.readFileSync)")
        node = shutil.which("node")
        if node:
            out = subprocess.run([node, os.path.join(path, "hook.js")], capture_output=True, text=True)
            self.assertEqual((out.returncode, out.stdout.strip()), (0, "function"), out.stderr)
        with open(os.path.join(wt, "package.json")) as f:
            self.assertNotIn("type", json.load(f))
        # a person's own file there stays as it is
        with open(os.path.join(wt, "package.json"), "w") as f:
            f.write('{"type": "module", "mine": 1}')
        self.new_worktree()
        with open(os.path.join(wt, "package.json")) as f:
            self.assertEqual(json.load(f)["mine"], 1)

    def test_default_branch_name_stays(self):
        t, _ = self.new_worktree(self.task("Fix the login page"))
        self.assertEqual(t["branch"], "task/fix-the-login-page")  # SHEP-322: no number in it

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
        # SHEP-322: {slug} alone is fine: a name already taken gets -2
        self.write_settings({"everywhere": {"tasks": {"branch": "feat/{slug}"}}})
        self.assertEqual(self.new_worktree(self.task("Fix login"))[0]["branch"], "feat/fix-login")
        self.assertEqual(self.new_worktree(self.task("Fix login"))[0]["branch"], "feat/fix-login-2")
        # one that can't be used (nothing of the task in it: every task would share it) falls back to the default
        self.write_settings({"everywhere": {"tasks": {"branch": "feat/x"}}})
        self.assertEqual(self.new_worktree(self.task("Fix login"))[0]["branch"], "task/fix-login")

    def test_pattern_problems(self):
        problem = self.settings.branch_pattern_problem
        for ok in ("", "task/{n}-{slug}", "{key}", "users/me/{key}-{slug}", "feat/{slug}"):
            self.assertIsNone(problem(ok), ok)
        for bad in ("feat/x", "x/{n}/{bad}", "{n} x", "-{n}", "a..{n}", "{key}.lock"):
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
        with self.assertRaisesRegex(self.Fail, 'the task "Check base" already uses it'):
            set_branch(self.store, t, "ABC-2")
        self.assertNotIn("branch", t)
        set_branch(self.store, t, "ABC-3")
        set_branch(self.store, t, "")  # back to the pattern
        self.assertNotIn("branch", t)
        with self.assertRaisesRegex(self.Fail, "in a worktree"):
            set_branch(self.store, self.task(mode="here"), "ABC-4")


class SetupBeforeTheAgent(unittest.TestCase):
    """#1197 (SHEP-272): Settings > Tasks > Before the agent starts (tasks.setup): a shell command run in each new
    worktree, in the agent's own terminal ahead of it; a failure holds the task with why and starts no agent.
    Throwaway repos and settings (NewWorktrees'); hc is never run."""

    setUp, git, commit, task, write_settings = (NewWorktrees.setUp, NewWorktrees.git, NewWorktrees.commit,
                                                NewWorktrees.task, NewWorktrees.write_settings)

    def begin(self, t, space="sp1"):
        """commands.begin with only the agent's start faked: what launch was given."""
        import herdr_task.commands as commands
        got = {}
        from unittest import mock
        with mock.patch.object(commands, "launch", lambda s, t, argv, space, message=None, parent=None, setup=None: got.update(setup=setup) or {"address": "x"}), \
                mock.patch.object(commands, "brief", lambda *a: "brief"), mock.patch.object(commands, "parent_for", lambda p, sp: None):
            commands.begin(self.store, t, ["claude"], space)
        return got["setup"]

    def test_runs_in_a_new_worktree_only(self):
        self.write_settings({"spaces": {"sp1": {"folder": self.main, "tasks": {"setup": "  bun install  "}}}})
        t = self.task()
        self.assertEqual(self.begin(t), "bun install")
        self.assertTrue(os.path.isdir(t["worktree"]))
        # started again in the worktree it has: not again
        self.assertIsNone(self.begin(t))
        # its last setup failed: again
        t["setup_failed"] = {"code": 1}
        self.assertEqual(self.begin(t), "bun install")
        self.assertNotIn("setup_failed", t)
        # a task in the folder itself, or a space with none set: nothing
        self.assertIsNone(self.begin(self.task(mode="here")))
        self.write_settings({})
        self.assertIsNone(self.begin(self.task()))
        # Everywhere's applies to every space
        self.write_settings({"everywhere": {"tasks": {"setup": "make deps"}}})
        self.assertEqual(self.begin(self.task(), space="other"), "make deps")

    def wrapper(self, setup):
        """SETUP_SH for real in sh: (exit code, its output, whether the agent ran, what _setup-failed got)."""
        d = tempfile.mkdtemp(dir=self.root)
        ht, called, ran = os.path.join(d, "ht"), os.path.join(d, "called"), os.path.join(d, "ran")
        with open(ht, "w") as f:
            f.write(f'#!/bin/sh\necho "$@" > {called}\n')
        os.chmod(ht, 0o755)
        log = os.path.join(d, "logs", "f-1.log")
        r = subprocess.run(["sh", "-c", self.launch.SETUP_SH, "herdr-setup", setup, log, ht, "SHEP-1", self.main,
                            "sh", "-c", f"echo agent > {ran}"], capture_output=True, text=True, cwd=self.main, stdin=subprocess.DEVNULL)
        got = open(called).read().strip() if os.path.exists(called) else None
        return r.returncode, r.stdout, os.path.exists(ran), got, log

    def test_the_agent_starts_only_after_it_succeeds(self):
        code, out, ran, called, log = self.wrapper("echo linking deps; ls >/dev/null")
        self.assertEqual((code, ran, called), (0, True, None))
        self.assertIn("linking deps", out)
        self.assertIn("Setup done. Starting the agent.", out)
        self.assertIn("linking deps", open(log).read())
        self.assertFalse(os.path.exists(log + ".rc"))

    def test_a_failure_holds_the_task_without_its_agent(self):
        code, out, ran, called, log = self.wrapper("echo missing bun >&2; exit 3")
        self.assertEqual((code, ran), (3, False))
        self.assertIn("Setup failed (exit 3), so the agent was not started.", out)
        self.assertEqual(called, f"_setup-failed SHEP-1 --folder {self.main} --code 3 --log {log}")
        self.assertIn("missing bun", open(log).read())  # stderr too

    def test_setup_failed_says_why(self):
        import herdr_task.commands as commands
        import herdr_task.base as base
        from herdr_task.agents import task_status
        from unittest import mock
        log = os.path.join(self.root, "f-1.log")
        with open(log, "w") as f:
            f.write("resolving\n\x1b[31merror: lockfile had changes\x1b[0m\n\n")
        t = self.task(state="running", agents=[{"address": "t1", "at": base.now()}], attention_at=1)
        args = __import__("argparse").Namespace(id="SHEP-1", folder=self.main, code=1, log=log)
        with mock.patch.object(commands, "open_store", lambda a: self.store):
            commands.cmd_setup_failed(args)
        self.assertEqual(t["setup_failed"]["code"], 1)
        self.assertIn("setup before the agent failed (exit 1): error: lockfile had changes. The agent didn't start.", t["attention"])
        self.assertIn(log, t["attention"])
        self.assertEqual(task_status(t, [])[:2], ("needs", "attention"))
        # started again at once: not "already running"
        self.assertIsNone(commands.just_started(t))

    def test_the_wrapper_goes_before_the_agent_in_its_command(self):
        cmd = self.launch.setup_argv(self.store, {"id": 4}, "bun install", ["claude", "brief"])
        self.assertEqual(cmd[:5], ["sh", "-c", self.launch.SETUP_SH, "herdr-setup", "bun install"])
        self.assertTrue(cmd[5].endswith(os.path.join(".setup", "f-4.log")))
        self.assertEqual(cmd[-4:], ["SHEP-4", self.main, "claude", "brief"])


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
        for mod, name, value in ((tick, "live_agents", lambda key: self.live), (tick, "detail", lambda k: k), (tick, "finish", done),
                                 (tick, "watch_main", lambda *a: None), (commands, "finish", done),
                                 (commands, "open_store", lambda args, write=True, wait=None: self.store),
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

    def test_the_accept_card_says_whether_accept_merges(self):
        """SHEP-225 (#1046): the evidence says `merges` exactly when Accept will merge (its branch has work of its
        own): the card's button then reads "Accept and merge", else plain "Accept"."""
        from unittest import mock
        import herdr_task.proof as proof
        with mock.patch.object(proof, "artifacts_of", lambda folder: []):
            merges = lambda: proof.evidence(self.store, self.task)["merges"]
            self.assertFalse(merges())  # nothing of its own yet: Accept only marks it done
            self.commit(self.task["worktree"], "its work")
            self.assertTrue(merges())
            self.git(self.main, "merge", "-q", "--ff-only", "task/1")  # merged by hand: nothing left to merge
            self.assertFalse(merges())
            self.task["pr"] = {"number": 7, "url": "https://example.com/pr/7"}  # an open pull request is merged
            with mock.patch.object(proof, "checks_of", lambda t: {"state": "none", "text": ""}):
                self.assertTrue(merges())
            self.task.pop("pr")
            self.task.update(mode="here")  # worked in the folder itself: never merges
            self.assertFalse(merges())

    def test_the_accept_card_shows_its_markdown_documents(self):
        """SHEP-273 (#1150): the evidence carries its new and changed Markdown files as they are on its branch, new
        ones first, a deleted one gone, other files never; `only` when every file it changed is Markdown."""
        from unittest import mock
        import herdr_task.proof as proof
        wt = self.task["worktree"]

        def write(path, text):
            os.makedirs(os.path.dirname(os.path.join(wt, path)) or wt, exist_ok=True)
            with open(os.path.join(wt, path), "w") as f:
                f.write(text)
            self.git(wt, "add", path)

        write("README.md", "# Old\n")
        write("gone.md", "bye\n")
        self.git(wt, "commit", "-q", "-m", "before")
        self.git(self.main, "merge", "-q", "--ff-only", "task/1")
        with mock.patch.object(proof, "artifacts_of", lambda folder: []):
            docs = lambda: proof.evidence(self.store, self.task)["docs"]
            self.assertIsNone(docs())  # nothing of its own yet
            write("plans/q3.md", "# Plan\n\n- one\n")
            write("README.md", "# New\n")
            self.git(wt, "rm", "-q", "gone.md")
            self.git(wt, "commit", "-q", "-m", "the plan")
            d = docs()
            self.assertEqual([(x["path"], x["new"]) for x in d["list"]], [("plans/q3.md", True), ("README.md", False)])
            self.assertEqual(d["list"][0]["text"], "# Plan\n\n- one")
            self.assertTrue(d["only"])
            self.assertEqual(d["count"], 2)
            write("app.py", "print(1)\n")
            write("long.markdown", "line\n" * (proof.DOC_MAX // 4))
            self.git(wt, "commit", "-q", "-m", "code too")
            d = docs()
            self.assertFalse(d["only"])
            long = next(x for x in d["list"] if x["path"] == "long.markdown")
            self.assertTrue(long["cut"])
            self.assertLessEqual(len(long["text"]), proof.DOC_MAX)
            self.assertTrue(long["text"].endswith("line"))
            self.assertNotIn("app.py", [x["path"] for x in d["list"]])
            # worked in the folder itself: its commits there, read as they are now
            self.task.update(mode="here", started=0, ready_at=0)
            self.store.loc["folder"] = wt
            d = docs()
            self.assertIn("plans/q3.md", [x["path"] for x in d["list"]])
            self.assertNotIn("gone.md", [x["path"] for x in d["list"]])

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

    def test_a_pull_request_merged_into_another_branch_is_done_too(self):
        """#1157: its pull request merged into a parent pull request's branch, not its base: its work merged all the
        same, so the task is done (before, it stayed open until someone ran herdr-task done)."""
        tip = self.change(self.task["worktree"], "reactions on the left")
        self.tick_once()
        self.github([{"number": 705, "url": "u", "isCrossRepository": False, "baseRefName": "feature/parent", "headRefOid": tip}])
        self.live, self.task["gh_checked"] = [], 0
        self.assertEqual(self.tick_once(), ("done", True))
        self.assertEqual(self.task["pr"]["number"], 705)

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
        for name, value in (("open_store", lambda args, write=True, wait=None: self.store), ("view", lambda s, t, live=None: {}),
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

    def test_a_status_at_least_every_5_minutes_its_time_left_revised_honestly(self):
        """SHEP-214: the system prompt and the brief's footer both ask for a status at least every 5
        minutes and an honest --left each time; an unedited earlier template gets today's words."""
        from herdr_task import templates
        with open(os.path.join(BIN, "herdr_task", "launch.py")) as f:
            launch = f.read()
        with open(os.path.join(ROOT, "templates", "worker.md")) as f:
            worker = f.read()
        for words in (templates.WORKER_MD, worker, launch):
            self.assertIn("at least every 5 minutes while you work", words)
            self.assertIn("revise it honestly", words)
            self.assertNotIn("update it at every step", words)
        with open(os.path.join(ROOT, "templates", "worker.md")) as f:
            line = [x for x in f.read().splitlines() if x.startswith("- Say how it's going")]
        self.assertEqual(line, [x for x in templates.WORKER_MD.splitlines() if x.startswith("- Say how it's going")])
        self.assertIn(templates.WORKER_MD_BEFORE_OFTEN, templates.OLD_WORKERS)
        self.assertNotEqual(templates.WORKER_MD_BEFORE_OFTEN, templates.WORKER_MD)

    def test_the_time_left_comes_from_the_clock_in_agent_time(self):
        """SHEP-361: the system prompt and the brief's footer have the agent note the clock, work --left
        out from its own pace, in its own working time; an unedited earlier template gets today's words."""
        from herdr_task import templates
        with open(os.path.join(BIN, "herdr_task", "launch.py")) as f:
            launch = f.read()
        with open(os.path.join(ROOT, "templates", "worker.md")) as f:
            worker = f.read()
        for words in (templates.WORKER_MD, worker, launch):
            self.assertIn("date +%s", words)
            self.assertIn("x (100 - done) / done", words)
            self.assertIn("never a person's", words)
            self.assertIn("by as much as you were off", words)
        self.assertIn("worked 12 min, 40% done: about 18m left", templates.WORKER_MD)
        self.assertIn(templates.WORKER_MD_BEFORE_CLOCK, templates.OLD_WORKERS)
        self.assertNotEqual(templates.WORKER_MD_BEFORE_CLOCK, templates.WORKER_MD)

    def test_titles_and_status_lines_fit_a_phone_row(self):
        """SHEP-370: a task's title and its agent's status line fit a phone's task row uncut: the Assistant, the
        worker's system prompt, its brief's footer and herdr-task's help all ask for at most ROW_MAX characters."""
        from herdr_task import templates
        from herdr_task.agents import ROW_MAX
        from herdr_task.cli import TITLE_HELP
        self.assertEqual(ROW_MAX, 30)
        with open(os.path.join(ROOT, "templates", "worker.md")) as f:
            worker = f.read()
        with open(os.path.join(ROOT, "templates", "assistant.md")) as f:
            assistant = f.read()
        for words in (templates.WORKER_MD, worker):
            self.assertNotIn("at most 40 characters", words)
            self.assertIn("with what you're doing now (at most 30 characters, so a phone's task row shows it uncut", words)
            self.assertIn('at most 30 characters, as it shows uncut on a phone, e.g. "Needs a go for a screenshot"', words)
        with open(os.path.join(BIN, "herdr_task", "launch.py")) as f:
            self.assertIn("at most {ROW_MAX} characters", f.read())
        self.assertIn("Titles: at most 30 characters", assistant)
        self.assertIn('becomes "Call button in the message box"', assistant)
        self.assertIn("at most 30 characters", TITLE_HELP)
        # every example of a good title or status is within the limit
        for good in ("Call button in the message box", "Fetch last month's invoices", "Fix login redirect loop",
                     "Running the full tests", "Needs a go for a screenshot"):
            self.assertLessEqual(len(good), ROW_MAX)
        self.assertIn(templates.WORKER_MD_BEFORE_ROW, templates.OLD_WORKERS)
        self.assertNotEqual(templates.WORKER_MD_BEFORE_ROW, templates.WORKER_MD)


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
            self.assertIn("claude --permission-mode dontAsk", words)
            self.assertNotIn("permission-mode plan", words)  # #1181
            self.assertIn("still at turn 0 after one, `hc read <its name>` to see why", words)  # #1191
            self.assertIn("`hc keys <its name> enter`", words)
            self.assertIn("exactly as the Reviewer line gives it", words)
            self.assertIn("hc wait <its name>", words)
            self.assertNotIn("< /dev/null", words)
        self.assertIn(templates.WORKER_MD_BEFORE_SUBAGENTS, templates.OLD_WORKERS)
        self.assertIn(templates.WORKER_MD_BEFORE_COMMAND, templates.OLD_WORKERS)
        self.assertIn(templates.WORKER_MD_BEFORE_WAIT, templates.OLD_WORKERS)
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
        """#840: a page can't be published and doctor can't reach the service in Codex's read-only sandbox."""
        sys.path.insert(0, BIN)
        from unittest import mock
        from herdr_task import templates
        with open(os.path.join(ROOT, "templates", "reviewer.md")) as f:
            words = f.read()
        for w in (words, templates.REVIEWER_MD):
            self.assertIn("`herdr-artifact publish` can't write its page there", w)
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
        self.assertIn("claude --permission-mode dontAsk --tools=Read,Grep,Glob,Bash --strict-mcp-config", r["value"]["command"])
        self.assertIn("Codex isn't signed in here", r["text"])
        self.assertIn("`codex login`", r["text"])

    def test_an_unknown_check_keeps_codex(self):
        self.assertEqual(self.line(None)["value"]["agent"], "codex")

    def test_codex_asked_now_for_a_brief(self):
        """#947: an unreadable Codex auth file answers `codex login status` with an error, which the periodic check
        can't read (unknown), and the reviewer sat on Codex's sign-in screen. A brief asks Codex now: not signed in,
        the task's own CLI reviews and the line says what Codex said."""
        from unittest import mock
        with open(self.checks, "w") as f:
            json.dump({"machines": {"": {"claude": "ready", "codex": None}}}, f)
        t = {"id": 1, "title": "x", "mode": "worktree"}
        said = "Error: premature end of input at line 10 column 46"
        with mock.patch.object(self.settings, "codex_login_now", lambda: (False, said)):
            r = next(x for x in self.settings.task_settings(Store([t]), t, argv=["claude"], live=True) if x["label"] == "Reviewer")
            shown = next(x for x in self.settings.task_settings(Store([t]), t, argv=["claude"]) if x["label"] == "Reviewer")
        self.assertEqual(r["value"]["agent"], "claude")
        self.assertIn("Codex isn't signed in here", r["text"])
        self.assertIn(said, r["text"])
        self.assertEqual(shown["value"]["agent"], "codex", "show never runs Codex: only a brief asks it now")
        with mock.patch.object(self.settings, "codex_login_now", lambda: (True, "")):
            r = next(x for x in self.settings.task_settings(Store([t]), t, argv=["claude"], live=True) if x["label"] == "Reviewer")
        self.assertEqual(r["value"]["agent"], "codex")

    def test_codex_login_now_reads_its_answer(self):
        """codex login status's own words: logged in, not logged in, or an error (also not signed in)."""
        from unittest import mock
        d = tempfile.mkdtemp()
        codex = os.path.join(d, "codex")
        for out, want in (("Logged in using ChatGPT", True), ("Not logged in", False),
                          ("Error: premature end of input at line 10 column 46", False)):
            with open(codex, "w") as f:
                f.write(f"#!/bin/sh\necho '{out}' >&2\nexit 1\n" if want is False else f"#!/bin/sh\necho '{out}'\n")
            os.chmod(codex, 0o755)
            with mock.patch.dict(os.environ, {"PATH": d + ":" + os.environ["PATH"]}), \
                    mock.patch.object(self.settings.shutil, "which", lambda name: codex):
                ok, said = self.settings.codex_login_now()
            self.assertEqual(ok, want, out)
            self.assertEqual(said, "" if want else out)

    def models_cache(self, *ids):
        from unittest import mock
        d = tempfile.mkdtemp()
        with open(os.path.join(d, "models_cache.json"), "w") as f:
            json.dump({"models": [{"slug": i, "display_name": i} for i in ids]}, f)
        p = mock.patch.dict(os.environ, {"CODEX_HOME": d})
        p.start()
        self.addCleanup(p.stop)

    def test_a_model_codex_lacks_is_its_default(self):
        """#948: Codex refused gpt-6.1-sol on a ChatGPT account, every round. The brief gives Codex's own default
        instead, and says why."""
        self.models_cache("gpt-6-sol", "gpt-6-luna")
        with open(self.checks, "w") as f:
            json.dump({"machines": {"": {"claude": "ready", "codex": "ready"}}}, f)
        t = {"id": 1, "title": "x", "mode": "worktree", "reviewer": "codex", "reviewer_model": "gpt-6.1-sol"}
        r = next(x for x in self.settings.task_settings(Store([t]), t, argv=["claude"]) if x["label"] == "Reviewer")
        self.assertEqual(r["value"]["agent"], "codex")
        self.assertIsNone(r["value"]["model"])
        self.assertNotIn("-m gpt-6.1-sol", r["value"]["command"])
        self.assertIn("Codex here doesn't offer gpt-6.1-sol", r["text"])
        t["reviewer_model"] = "gpt-6-sol"
        r = next(x for x in self.settings.task_settings(Store([t]), t, argv=["claude"]) if x["label"] == "Reviewer")
        self.assertIn("-m gpt-6-sol", r["value"]["command"])

    def test_a_model_codex_lacks_is_refused_when_set(self):
        """#948: caught when it is picked (add/edit --reviewer-model or --set reviewer.model), with what Codex offers."""
        from types import SimpleNamespace
        self.models_cache("gpt-6-sol", "gpt-6-luna")
        args = lambda **k: SimpleNamespace(**{"agent": None, "model": None, "effort": None, "reviewer": None,
                                              "reviewer_model": None, "reviewer_effort": None, "set": None, **k})
        with self.assertRaises(self.settings.Fail) as e:
            self.settings.set_opts({}, args(reviewer_model="gpt-6.1-sol"))
        self.assertIn("gpt-6-sol, gpt-6-luna", str(e.exception))
        with self.assertRaises(self.settings.Fail):
            self.settings.set_opts({}, args(set=["reviewer.model=gpt-6.1-sol"]))
        t = {}
        self.settings.set_opts(t, args(reviewer_model="gpt-6-sol"))
        self.assertEqual(t["reviewer_model"], "gpt-6-sol")
        # a Claude model, or a Claude reviewer, isn't Codex's to judge
        self.settings.set_opts({}, args(reviewer_model="opus"))
        self.settings.set_opts({}, args(reviewer="claude", reviewer_model="some-model"))

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

    def test_a_brief_unknown_after_mergeable_stays_ready(self):
        # #1151: the base moved, GitHub works mergeable out again: the same head stays Ready
        t = self.said_ready()
        self.github_says(checks=[self.PASSED])
        self.assertEqual(self.look(t), ("ready", None, "ready"))
        self.github_says(mergeable="UNKNOWN", checks=[self.PASSED])
        self.assertEqual(self.look(t), ("ready", None, "ready"))
        self.assertNotIn("wait", t["pr"])

    def test_unknown_for_minutes_is_ready_anyway(self):
        # #1151: GitHub never settles on a new head: Working a few minutes at most
        t = self.said_ready()
        self.github_says(mergeable="UNKNOWN", checks=[self.PASSED])
        self.assertEqual(self.look(t), ("working", "Waiting for GitHub", None))
        self.assertEqual(self.look(t, after=5 * 60_000)[:2], ("ready", None))

    def test_no_clear_mergeable_answer_is_ready_after_a_few_minutes(self):
        # #1049: a mergeable answer that is neither yes, no nor UNKNOWN (missing, a host's own word) is asked again
        # and waits a few minutes at most, never Working for good
        for word in ("", "FALSE"):
            t = self.said_ready()
            self.github_says(mergeable=word, checks=[self.PASSED])
            self.assertEqual(self.look(t), ("working", "Waiting for GitHub", None))
            self.assertEqual(self.look(t, after=5 * 60_000)[:2], ("ready", None))

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


class PrWhileWorking(PrLooks):
    """#1176: a pull request its agent opened before ready shows on the task (its number, a link, its Pull request tab)
    while it still works: the tick looks its branch up every few minutes."""

    def gh_script(self):
        return ("#!/usr/bin/env python3\nimport json, sys\n"
                f"open({self.gh_log!r}, 'a').write(json.dumps(sys.argv[1:]) + '\\n')\n"
                "if sys.argv[1:3] == ['pr', 'list']:\n"
                f"    print(open({os.path.join(self.dir, 'list.json')!r}).read())\n")

    def lists(self, rows):
        with open(os.path.join(self.dir, "list.json"), "w") as f:
            json.dump(rows, f)

    def test_its_agents_pull_request_shows_while_it_works(self):
        t = {"id": 9, "title": "Login", "state": "running", "agents": [], "mode": "worktree", "worktree": self.dir, "branch": "b"}
        self.store.data["tasks"] = [t]
        self.lists([])
        with unittest.mock.patch.object(self.tick, "github", lambda s: "o/r"):
            self.tick.seen_pr(self.store, t)
            self.assertNotIn("pr_seen", t)
            self.lists([{"number": 20, "url": "https://github.com/o/r/pull/20", "isCrossRepository": False, "baseRefName": "main"}])
            self.tick.seen_pr(self.store, t)
            self.assertNotIn("pr_seen", t)  # asked at most every few minutes
            self.clock[0] += self.tick.PR_OPEN_EVERY
            self.tick.seen_pr(self.store, t)
            self.assertEqual(t["pr_seen"], {"number": 20, "url": "https://github.com/o/r/pull/20", "repo": "o/r"})
            # ready records it as its own: the seen one goes
            t["pr"] = {"number": 20, "url": "https://github.com/o/r/pull/20", "repo": "o/r"}
            self.tick.seen_pr(self.store, t)
            self.assertNotIn("pr_seen", t)


class RequiredChecksOnly(PrLooks):
    """GitHub #1221: merge 'after checks' waits on the base branch's required checks only (GitHub marks them: the
    GraphQL isRequired), so a red or running optional check never stops it merging or queueing."""

    BUILD = {"name": "build", "status": "COMPLETED", "conclusion": "SUCCESS"}
    LINT_RED = {"name": "lint", "status": "COMPLETED", "conclusion": "FAILURE", "detailsUrl": ""}
    BUILD_RED = {"name": "build", "status": "COMPLETED", "conclusion": "FAILURE", "detailsUrl": ""}

    def gh_script(self):
        required = os.path.join(self.dir, "required.json")
        return ("#!/usr/bin/env python3\nimport json, sys\n"
                f"open({self.gh_log!r}, 'a').write(json.dumps(sys.argv[1:]) + '\\n')\n"
                "if sys.argv[1:3] == ['pr', 'view']:\n"
                f"    print(open({os.path.join(self.dir, 'view.json')!r}).read())\n"
                "elif sys.argv[1:3] == ['api', 'graphql'] and 'isRequired' in ' '.join(sys.argv):\n"
                f"    print(open({required!r}).read())\n"
                "elif sys.argv[1] == 'api':\n    print('[]')\n")

    def requires(self, *names, rows=("build", "lint")):
        nodes = [{"__typename": "CheckRun", "name": n, "isRequired": n in names} for n in rows]
        with open(os.path.join(self.dir, "required.json"), "w") as f:
            json.dump({"data": {"repository": {"pullRequest": {"commits": {"nodes": [
                {"commit": {"statusCheckRollup": {"contexts": {"nodes": nodes}}}}]}}}}}, f)

    def auto(self):
        t = self.said_ready()
        t["auto_merge"], t["state"], t["ready_at"] = "checks", "ready", 1
        return t

    def merge(self, t):
        for name in ("watch_main", "update_main"):
            p = unittest.mock.patch.object(self.commands, name, lambda *a, **k: None)
            p.start()
            self.addCleanup(p.stop)
        p = unittest.mock.patch.object(self.commands, "finish", lambda s, t, even_if_busy=False: t.update(state="done"))
        p.start()
        self.addCleanup(p.stop)
        return self.commands.merge_now(self.store, t)

    def merged(self):
        with open(self.gh_log) as f:
            return any(a[:2] == ["pr", "merge"] for a in map(json.loads, f))

    def test_a_red_optional_check_never_stops_it(self):
        t = self.auto()
        self.requires("build")
        self.github_says(checks=[self.BUILD, self.LINT_RED])
        self.look(t)
        self.assertNotIn("attention", t)
        self.assertNotIn("wait", t["pr"])
        self.assertEqual(self.merge(t), self.commands.IN_QUEUE)  # merged on GitHub (this fake's pull request stays open)
        self.assertTrue(self.merged())

    def test_a_red_required_check_still_does(self):
        t = self.auto()
        self.requires("build")
        self.github_says(checks=[self.BUILD_RED, self.LINT_RED])
        self.look(t, after=1000)
        self.assertEqual(t["attention"], "Checks failing: build.")
        self.assertEqual(self.merge(t), "Checks failing: build.")
        self.assertFalse(self.merged())

    def test_a_running_optional_check_isnt_waited_on(self):
        t = self.auto()
        self.requires("build")
        self.github_says(checks=[self.BUILD, {"name": "lint", "status": "IN_PROGRESS", "conclusion": ""}])
        self.assertEqual(self.merge(t), self.commands.IN_QUEUE)  # merged on GitHub (this fake's pull request stays open)
        self.assertTrue(self.merged())

    def test_no_required_checks_waits_on_every_one_as_before(self):
        t = self.auto()
        self.requires()
        self.github_says(checks=[self.BUILD, self.LINT_RED])
        self.look(t, after=1000)
        self.assertEqual(t["attention"], "Checks failing: lint.")

    LINT_RUNS = {"name": "lint", "status": "IN_PROGRESS", "conclusion": ""}

    def test_on_its_own_never_waits_for_a_check_nobody_requires(self):
        # Merge "on its own" on a base that requires no checks: a running optional one is no wait, and its row says
        # Merging, not "Merges once its checks pass".
        t = self.auto()
        t["auto_merge"] = "auto"
        self.requires()
        self.github_says(checks=[self.BUILD, self.LINT_RUNS])
        self.look(t)
        self.assertNotIn("wait", t["pr"])
        self.assertEqual(self.agents.ready_wait(t, []), "Merging")
        self.assertEqual(self.merge(t), self.commands.IN_QUEUE)  # merged on GitHub (this fake's pull request stays open)
        self.assertTrue(self.merged())

    def test_after_checks_still_waits_for_a_running_one_nobody_requires(self):
        t = self.auto()
        self.requires()
        self.github_says(checks=[self.BUILD, self.LINT_RUNS])
        self.assertEqual(self.agents.ready_wait(t, []), "Merges once its checks pass")
        self.assertEqual(self.merge(t), self.commands.CHECKS_RUNNING)
        self.assertFalse(self.merged())

    def test_on_its_own_still_waits_for_a_required_check(self):
        t = self.auto()
        t["auto_merge"] = "auto"
        self.requires("build")
        self.github_says(checks=[{"name": "build", "status": "IN_PROGRESS", "conclusion": ""}, self.LINT_RUNS])
        self.assertEqual(self.merge(t), self.commands.CHECKS_RUNNING)
        self.assertFalse(self.merged())

    def test_a_merge_by_hand_follows_its_merge_setting(self):
        # herdr-task merge on a task set to merge on its own (auto_merge not set yet): no wait for an optional check.
        t = self.auto()
        t.pop("auto_merge")
        t["set"] = {"merge": "auto"}
        self.requires()
        self.github_says(checks=[self.BUILD, self.LINT_RUNS])
        self.assertEqual(self.merge(t), self.commands.IN_QUEUE)
        self.assertTrue(self.merged())

    def test_github_unable_to_say_waits_on_every_one_on_its_own_too(self):
        t = self.auto()
        t["auto_merge"] = "auto"
        with open(os.path.join(self.dir, "required.json"), "w") as f:
            f.write("not json")
        self.github_says(checks=[self.BUILD, self.LINT_RUNS])
        self.assertEqual(self.merge(t), self.commands.CHECKS_RUNNING)

    def test_github_unable_to_say_waits_on_every_one(self):
        t = self.auto()
        with open(os.path.join(self.dir, "required.json"), "w") as f:
            f.write("not json")
        self.github_says(checks=[self.BUILD, self.LINT_RED])
        self.assertEqual(self.merge(t), "Checks failing: lint.")

    def test_all_green_asks_github_nothing_more(self):
        t = self.auto()
        self.requires("build")
        self.github_says(checks=[self.BUILD])
        self.assertEqual(self.merge(t), self.commands.IN_QUEUE)  # merged on GitHub (this fake's pull request stays open)
        with open(self.gh_log) as f:
            self.assertFalse(any(a[:2] == ["api", "graphql"] for a in map(json.loads, f)))

    def test_accept_without_after_checks_still_bounces_a_red_optional_check_to_its_agent(self):
        # Not merging by itself: a Ready task's red check still goes back to its agent, as before.
        t = self.said_ready()
        self.requires("build")
        self.github_says(checks=[self.BUILD, self.LINT_RED])
        self.assertEqual(self.look(t, after=1000)[:2], ("working", "Back to its agent to fix"))


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
        t["state"], t["ready_at"] = "ready", 1  # past the moment GitHub gets to start checks (#1044)
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

    def name(self, t):
        return '"' + " ".join(str(t.get("title") or "").split()) + '"'

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
        return self.run_cmd(self.commands.cmd_add, title=title, **kw)

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

    def test_any_number_run_at_once(self):
        """3.2: no "Tasks at once". A stored tasks.max_running is ignored: a task starts the moment it is asked to."""
        import herdr_task.settings as settings
        with open(settings.SETTINGS, "w") as f:
            json.dump({"everywhere": {"tasks": {"max_running": 1}}}, f)
        self.add("Busy one")
        self.run_cmd(self.commands.cmd_start, id="1", now=False)
        self.add("Another")
        out = self.run_cmd(self.commands.cmd_start, id="2", now=False)
        self.assertNotIn("queued", out)
        self.assertEqual(self.task(2)["state"], "running")
        v = self.add("Later", in_="1h")
        self.assertEqual(self.tick_at(v["scheduled_for"] + 1000), ["APP-3"])
        with self.store_mod.Store(self.store_mod.locate(self.folder)) as s:
            self.assertFalse(hasattr(s, "max_running"))

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

    def test_codex_ultrafast(self):
        """SHEP-258: a role set to Codex's Ultrafast starts on that tier; Claude Code reads it as Fast."""
        sys.path.insert(0, BIN)
        from herdr_task.settings import argv_for
        a = argv_for({"agent": "codex", "model": "gpt-6.2-sol", "effort": "low", "fast": "ultrafast"})
        self.assertEqual(a, ["codex", "--no-daemon", "-m", "gpt-6.2-sol", "-c", 'model_reasoning_effort="low"',
                             "-c", 'service_tier="ultrafast"'])
        self.assertIn('service_tier="fast"', argv_for({"agent": "codex", "model": "gpt-6.2-astra", "fast": True}))
        self.assertIn('{"fastMode": true}', argv_for({"agent": "claude", "fast": "ultrafast"}))


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
            # 3.2: an artifact is a page (its files include index.html), one kind only: one that isn't a page yet is no proof
            self.assertIsNone(proof.find_proof(s, t))
            arts[1]["files"] = ["index.html", "shot.png"]
            self.assertEqual(proof.find_proof(s, t), {"id": "proof-0002", "title": "SHEP-1: Reactions · Proof"})
            self.assertEqual(proof.find_proof(s, t, "report-0003")["id"], "report-0003")
            with self.assertRaises(Exception):
                proof.find_proof(s, t, "nope-0009")
            # the one published as its proof (herdr-artifact publish --proof) wins over a title, whatever it is called
            arts[0].update(files=["index.html"], proof=True)
            self.assertEqual(proof.find_proof(s, t), {"id": "report-0003", "title": "SHEP-1: Three options"})
            # one from before it started, or another task's, never
            arts[3].update(files=["index.html"], proof=True)
            arts[0]["proof"] = arts[1]["files"] = None
            self.assertIsNone(proof.find_proof(s, t))


class ProofFromAnotherFolder(unittest.TestCase):
    """A proof published from a scratch folder (herdr-artifact publish --task, the real command on a throwaway
    home) is found by ready --proof in its task's folder; one an older herdr-artifact filed under the scratch folder
    is found by its id too."""

    def setUp(self):
        import shutil
        self.home = os.path.realpath(tempfile.mkdtemp(prefix="shepherdr-proof-elsewhere-"))
        self.addCleanup(shutil.rmtree, self.home, True)
        self.task_folder, self.scratch = os.path.join(self.home, "proj"), os.path.join(self.home, "scratch")
        os.makedirs(os.path.join(self.scratch, "page"))
        os.makedirs(self.task_folder)
        os.makedirs(os.path.join(self.home, ".herdr", "tasks"))
        with open(os.path.join(self.home, ".herdr", "tasks", "proj.json"), "w") as f:
            json.dump({"prefix": "SHEP", "folder": self.task_folder, "tasks": [{"id": 1}]}, f)
        with open(os.path.join(self.scratch, "page", "index.html"), "w") as f:
            f.write("<!doctype html><title>x</title><h1>Proof</h1>")

    def publish(self, *args):
        tool = os.path.join(ROOT, "mods", "artifacts", "bin", "herdr-artifact")
        env = {**os.environ, "HOME": self.home, "HERDR_ARTIFACT_CHROME": ""}
        for k in ("SHEPHERDR_HOME", "XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "HC_TERMINAL_ID", "HERDR_BROWSER_TASK"):
            env.pop(k, None)
        p = subprocess.run([sys.executable, "-B", tool, "publish", "page", "--title", "Reactions · Proof", "--json", *args],
                           cwd=self.scratch, env=env, capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr + p.stdout)
        return json.loads(p.stdout.strip().splitlines()[-1])

    def found(self, given=None):
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.proof as proof
        s = Store([{"id": 1, "title": "Reactions", "state": "doing", "started": 0, "agents": []}])
        s.loc["folder"] = self.task_folder
        with mock.patch.object(proof, "ARTIFACTS", os.path.join(self.home, ".herdr", "artifacts")), \
                mock.patch.object(proof, "HOME", self.home):
            return proof.find_proof(s, s.data["tasks"][0], given)

    def test_published_from_a_scratch_folder_ready_finds_it(self):
        a = self.publish("--task", "SHEP-1", "--proof")
        self.assertEqual(a["folder"], self.task_folder)
        self.assertEqual(self.found(a["id"]), {"id": a["id"], "title": "Reactions · Proof"})
        self.assertEqual(self.found()["id"], a["id"])  # ready without --proof finds it too

    def test_a_proof_an_older_version_filed_under_the_scratch_folder_is_found_by_its_id(self):
        a = self.publish("--task", "SHEP-1", "--proof", "--folder", self.scratch)  # where an older one put it
        self.assertEqual(a["folder"], self.scratch)
        self.assertEqual(self.found(a["id"])["id"], a["id"])
        with self.assertRaisesRegex(Exception, "No artifact nope-0009"):
            self.found("nope-0009")


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


class MacMemoryIsWhatMacOSCallsFree(unittest.TestCase):
    """SHEP-199 / GitHub #922: on a Mac the memory hold reads macOS's own free share
    (kern.memorystatus_level, the figure memory_pressure prints), not a sum of vm_stat pages that
    leaves out the cache macOS counts as free. Only sysctl and vm_stat are faked; the numbers are
    the report's: vm_stat's sum says 81% used, macOS says 39% free (61% used)."""

    TOTAL = 16 * 2 ** 30  # 16 GB, 16 KB pages: 1048576 pages
    VM_STAT = """Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                 40000.
Pages active:                              300000.
Pages inactive:                            120000.
Pages speculative:                           9000.
Pages throttled:                                0.
Pages wired down:                          150000.
Pages purgeable:                            30000.
File-backed pages:                          90000.
Anonymous pages:                           250000.
Pages stored in compressor:                 80000.
Pages occupied by compressor:               40000.
"""

    def setUp(self):
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.machine as machine
        self.machine = machine
        self.sysctl_level = "39\n"
        fake = {"sysctl -n hw.memsize": "%d\n" % self.TOTAL, "vm_stat": self.VM_STAT}

        def run(argv, timeout=10):
            key = " ".join(argv)
            if key == "sysctl -n kern.memorystatus_level":
                return self.sysctl_level
            return fake.get(key, "")
        for name, value in (("MAC", True), ("_run", run)):
            p = mock.patch.object(machine, name, value)
            p.start()
            self.addCleanup(p.stop)

    def test_uses_the_free_share_macos_reports(self):
        total, used = self.machine._memory()
        self.assertEqual(total, self.TOTAL)
        self.assertEqual(round(used * 100 / total), 61)  # 100 - 39, not vm_stat's 81
        self.assertEqual(self.machine.sample()["memory"], 61)

    def test_without_the_sysctl_counts_vm_stat_pages(self):
        self.sysctl_level = ""
        total, used = self.machine._memory()
        # free + inactive + speculative + purgeable = 199000 of 1048576 pages: 81% used
        self.assertEqual(round(used * 100 / total), 81)


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
        for name, value in (("open_store", lambda args, write=True, wait=None: self.store), ("view", lambda s, t, live=None: dict(t)),
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


class GitNeverAsksForAPassword(unittest.TestCase):
    """#1260: herdr-task's fetch or push to an HTTPS remote with no credential helper waited hours for a username
    on the terminal, and every herdr-task call for that folder hung. It fails at once and says why instead."""

    @unittest.skipUnless(sys.platform.startswith("linux"), "the controlling-terminal trick is Linux's")
    def test_fetch_from_a_remote_that_wants_a_password_fails_fast(self):
        import http.server
        import pty
        import threading

        class Refuse(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(401)
                self.send_header("WWW-Authenticate", 'Basic realm="x"')
                self.send_header("Content-Length", "0")
                self.end_headers()

            def log_message(self, *a):
                pass

        srv = http.server.HTTPServer(("127.0.0.1", 0), Refuse)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.addCleanup(srv.shutdown)
        repo = tempfile.mkdtemp()
        subprocess.run(["git", "init", "-q", repo], check=True)
        subprocess.run(["git", "-C", repo, "remote", "add", "origin", f"http://127.0.0.1:{srv.server_port}/r.git"], check=True)
        # A real terminal, as in the report: git would prompt on it and wait for an answer that never comes.
        main_fd, tty = pty.openpty()
        self.addCleanup(os.close, main_fd)
        tty_name = os.ttyname(tty)
        os.close(tty)

        def own_terminal():
            os.setsid()
            os.close(os.open(tty_name, os.O_RDWR))  # the first terminal a session leader opens becomes its own

        code = ("import sys, json; sys.dont_write_bytecode = True; sys.path.insert(0, sys.argv[1]);"
                "from herdr_task.base import git; print(json.dumps(git(sys.argv[2], 'fetch', 'origin')))")
        env = {k: v for k, v in os.environ.items() if k not in ("GIT_TERMINAL_PROMPT", "GIT_ASKPASS", "SSH_ASKPASS", "GCM_INTERACTIVE")}
        env.update({"GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"})
        try:
            out = subprocess.run([sys.executable, "-c", code, BIN, repo], capture_output=True, text=True, env=env,
                                 preexec_fn=own_terminal, timeout=20)
        except subprocess.TimeoutExpired:
            self.fail("git waited for a password")
        ok, _, err = json.loads(out.stdout)
        self.assertFalse(ok)
        self.assertIn("git can't sign in to the remote", err)


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
        task = {"id": 6, "title": "fake", "agents": []}
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
        """herdr-task and the service (core/clean-env.js), and restart.sh while it exists, clear the same names."""
        sys.path.insert(0, BIN)
        import herdr_task.launch as L
        js = subprocess.run(["sh", "-c", 'grep -o "export const CLEAN_ENV = .*" "$1"', "x", os.path.join(ROOT, "core", "clean-env.js")],
                            capture_output=True, text=True).stdout.strip()
        self.assertEqual(js.split("`")[1].replace("\\\\", "\\"), L.CLEAN_ENV)
        restart = os.path.join(ROOT, "mods", "coordinator", "restart.sh")
        if not os.path.isfile(restart):  # 3.2: the window's mods are gone
            return
        line = subprocess.run(["bash", "-c", 'eval "$(grep "^clean=" "$1")"; printf %s "$clean"', "x", restart], capture_output=True, text=True).stdout
        self.assertEqual(line, L.CLEAN_ENV)
        self.assertEqual(self.agent_env(["sh", "-c", line + ' exec env']).keys() & self.MARKERS.keys(), set())


class NeverRevived(unittest.TestCase):
    """3.2 (step 38): an Assistant or a task's agent the core gave a plain shell (a crash, a power loss, a reboot) is
    never typed back into that shell. Each tick still records a running agent's session on its terminal (the chat
    reads its log from there). A fake core in memory: hc and the agents' session files are never touched."""

    def setUp(self):
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.revive as revive
        self.r, self.mock = revive, mock
        self.dir = tempfile.mkdtemp()
        self.log = os.path.join(self.dir, "S1.jsonl")
        open(self.log, "w").close()
        self.terms, self.sessions = {}, {}

        def hc(args, env=None):
            if args[:2] != ["hc", "label"]:
                raise AssertionError(f"ran {args}")  # never a send, a read or a kill
            k, v = args[3].split("=", 1)
            self.terms[args[2]].setdefault("labels", {})[k] = v
            return subprocess.CompletedProcess(args, 0, "", "")

        def hc_json(*args):
            if args == ("ls",):
                return {"terminals": [{"address": a, "state": t["state"]} for a, t in self.terms.items()]}
            if args[0] == "get":
                return json.loads(json.dumps(self.terms[args[1]]))
            raise AssertionError(f"hc {args}")
        for name, value in (("run", hc), ("hc_json", hc_json), ("session_of", lambda pid: self.sessions.get(pid, (None, None)))):
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
        self.r.record_pass(report)
        return report

    def test_a_running_agents_session_is_recorded(self):
        self.assistant()
        self.assertEqual(self.tick().get("recorded"), ["t1"])
        rec = json.loads(self.terms["t1"]["labels"]["herdr.resume"])
        self.assertEqual((rec["session"], rec["log"], rec["argv"], rec["pid"], rec["shell"]), ("S1", self.log, ["claude", "--model", "opus"], 100, False))
        self.assertEqual(self.tick(), {})  # nothing new: not written again

    def test_a_crashed_agent_is_left_as_it_is(self):
        self.assistant(status="working")
        self.tick()
        self.crash("t1")
        self.assertEqual(self.tick(), {})  # nothing typed into its shell (the fake core refuses a send), nothing reported
        self.assertEqual(json.loads(self.terms["t1"]["labels"]["herdr.resume"])["session"], "S1")  # its session stays known, for Restart

    def test_other_terminals_are_left_alone(self):
        self.terms["t3"] = {"address": "t3", "state": "live", "pid": 5, "argv": ["/bin/bash"], "labels": {},
                            "foreground": {"pid": 5, "name": "bash", "argv": ["/bin/bash"]}}
        self.assertEqual(self.tick(), {})
        self.assertNotIn("herdr.resume", self.terms["t3"]["labels"])

    def test_nothing_restarts_an_agent_by_itself(self):
        """No pass of the tick or the scheduler types an agent back, retries a cut turn or hands a task to a backup."""
        import herdr_task.tick as tick
        import herdr_task.automations as au
        import herdr_task.takeover as takeover
        import herdr_task.provider as provider
        for mod, names in ((tick, ("revive_pass", "retry_pass", "retry_one", "takeover")), (au, ("retry_pass", "backup_pass")),
                           (takeover, ("takeover", "backup_for", "handover")), (self.r, ("revive_pass", "plan", "shell_line")),
                           (provider, ("NUDGE", "PROVIDER_WAITS"))):
            for name in names:
                self.assertFalse(hasattr(mod, name), f"{mod.__name__}.{name}")
        self.assertFalse(os.path.exists(os.path.join(BIN, "herdr_task", "autopilot.py")))


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
                   mock.patch.object(home, "home_pass", lambda r: None),
                   mock.patch.dict(os.environ, {"HC_TERMINAL_ID": ""})]
        patches += [mock.patch.object(au, n, lambda *a, **k: None) for n in (
            "tick_store", "stopped_pass", "archive_pass", "news_pass", "end_done_pass", "memory_guard",
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
                                       parent=None, here=False, worktree=False, from_=None)
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

    def round_at(self, at_ms):
        from unittest import mock
        with mock.patch.object(self.au, "now", lambda: at_ms):
            return self.round()

    def test_a_blip_is_no_needs_you(self):
        """SHEP-242: B not answering for a round or two (a busy line) flags nothing; auto show keeps why."""
        self.b_task("Fix one")
        self.auto("add", title="Update", prompt="Go.", on="merged", from_=f"vmb:{self.b_folder}")
        t0 = 1_800_000_000_000
        self.round_at(t0)
        self.b_up = False
        self.round_at(t0 + 15_000)
        self.round_at(t0 + 30_000)
        shown = self.auto("show", id="1")
        self.assertIsNone(shown["last_error"])  # no Needs you
        self.assertEqual(shown["from_error"]["misses"], 2)
        self.assertIn("connection refused", shown["from_error"]["message"])
        listed = self.auto("list", all=False)
        self.assertFalse(any(a.get("last_error") for a in listed))
        self.b_up = True
        self.round_at(t0 + 45_000)
        self.assertIsNone(self.auto("show", id="1")["from_error"])

    def test_a_long_outage_says_so_then_clears_on_recovery(self):
        """SHEP-242: B down every round for 15 minutes: Needs you, in plain words ("Can't reach vmb since ..."),
        not "Didn't start its task"; B back: the flag goes, and is saved."""
        import datetime
        self.b_task("Fix one")
        self.auto("add", title="Update", prompt="Go.", on="merged", from_=f"vmb:{self.b_folder}")
        t0 = 1_800_000_000_000
        self.round_at(t0)
        self.b_up = False
        down = t0 + 15_000
        for k in range(0, 14 * 60_000, 60_000):
            self.round_at(down + k)
        self.assertIsNone(self.auto("show", id="1")["last_error"])  # 14 minutes: still quiet
        self.round_at(down + 15 * 60_000)
        err = self.auto("show", id="1")["last_error"]
        since = f"{datetime.datetime.fromtimestamp(down / 1000):%H:%M}"
        self.assertEqual(err["kind"], "from")
        self.assertEqual(err["message"], f"Can't reach vmb since {since}")
        self.assertIn("connection refused", err["detail"])
        self.assertNotIn("start", err["message"])
        # B answers again: the flag is gone from the saved list, with nothing else to save that round
        self.b_up = True
        self.round_at(down + 16 * 60_000)
        shown = self.auto("show", id="1")
        self.assertIsNone(shown["last_error"])
        self.assertIsNone(shown["from_error"])

    def test_recovery_saves_a_cleared_error(self):
        """SHEP-242: a "from" error (as an older herdr-task kept it, no from_error) clears on B's next answer and is
        saved, though that round changes nothing else."""
        self.b_task("Fix one")
        self.auto("add", title="Update", prompt="Go.", on="merged", from_=f"vmb:{self.b_folder}")
        self.round()
        from herdr_task.store import locate, Store
        with Store(locate(self.a_folder)) as s:
            s.data["automations"][0]["last_error"] = {"at": 1, "message": "Couldn't ask vmb: down", "kind": "from"}
            s.dirty = True
        self.assertIsNotNone(self.auto("show", id="1")["last_error"])
        self.round()
        self.assertIsNone(self.auto("show", id="1")["last_error"])

    def test_missed_while_down_is_caught_up_once(self):
        self.b_task("Fix one")
        self.auto("add", title="Update", prompt="Go.", on="merged", from_=f"vmb:{self.b_folder}")
        self.round()
        # B can't be reached: its merges meanwhile wait, and nothing fires
        self.b_up = False
        self.b_merge(1)
        self.b_task("Fix two", state="done", merged=True)  # added and merged while unseen
        self.assertEqual(self.round(), [])
        self.assertIn("Couldn't ask vmb", self.auto("show", id="1")["from_error"]["message"])
        # B is back: each merge fires once, the error goes
        self.b_up = True
        self.assertEqual(sorted(f["why"] for f in self.round()), ["merged: vmb:SHEP-1", "merged: vmb:SHEP-2"])
        self.assertEqual(self.round(), [])
        self.assertIsNone(self.auto("show", id="1")["from_error"])
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

    def b_cmd(self, *argv):
        """B's own herdr-task, as the person or an agent there runs it."""
        b = ("import sys, runpy; sys.dont_write_bytecode = True; sys.path.insert(0, sys.argv[1]);"
             "import herdr_task.base as base; base.not_real = lambda: None;"
             "sys.argv = sys.argv[2:]; runpy.run_path(sys.argv[0], run_name='__main__')")
        r = subprocess.run([sys.executable, "-c", b, BIN, os.path.join(BIN, "herdr-task"), *argv, "--folder", self.b_folder],
                           env=self.b_env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(os.path.join(self.b_store, self.b_folder.strip("/").replace("/", "-") + ".json")) as f:
            self.b_tasks = json.load(f)["tasks"]

    def test_merged_then_reopened_between_rounds_fires_once(self):
        """SHEP-423, the missed 3.2.6: its release task was accepted (merged), then reopened for its agent to tag it
        and done again, all between two of A's rounds. Done again it read "not merged", so no round ever saw a merge."""
        self.b_task("Release Shepherdr 3.2.6", state="ready")
        self.auto("add", title="Update Shepherdr everywhere", prompt="Go.", on="merged", match="Release Shepherdr",
                  from_=f"vmb:{self.b_folder}")
        self.assertEqual(self.round(), [])
        self.b_merge(1)
        self.b_cmd("reopen", "SHEP-1")
        self.b_cmd("done", "SHEP-1")
        self.assertTrue(self.b_tasks[0]["merged"])  # done again, still merged
        self.assertEqual([f["why"] for f in self.round()], ["merged: vmb:SHEP-1"])
        # reopened and done again once more (seen this time): never a second run
        self.b_cmd("reopen", "SHEP-1")
        self.assertEqual(self.round(), [])
        self.b_cmd("done", "SHEP-1")
        self.assertEqual(self.round() + self.round(), [])
        self.assertEqual(len(self.started), 1)

    def test_merged_then_reopened_seen_while_reopened(self):
        """A round that only sees it reopened (Working again after its merge) fires then, and once."""
        self.b_task("Release one", state="ready")
        self.auto("add", title="Update", prompt="Go.", on="merged", from_=f"vmb:{self.b_folder}")
        self.round()
        self.b_merge(1)
        self.b_cmd("reopen", "SHEP-1")
        self.assertEqual([f["why"] for f in self.round()], ["merged: vmb:SHEP-1"])
        self.b_cmd("done", "SHEP-1")
        self.assertEqual(self.round(), [])

    def test_an_older_record_never_fires_a_seen_merge_again(self):
        """A record kept before SHEP-423 (no "merged" in it) that saw a task done: done again merged is no news."""
        self.b_task("Fix one")
        self.auto("add", title="Update", prompt="Go.", on="merged", from_=f"vmb:{self.b_folder}")
        self.b_merge(1)
        self.assertEqual(len(self.round()), 1)
        from herdr_task.store import locate, Store
        with Store(locate(self.a_folder)) as s:
            for rec in s.data["automations"][0]["from_seen"].values():
                if isinstance(rec, dict):
                    rec.pop("merged", None)
            s.dirty = True
        self.b_cmd("reopen", "SHEP-1")
        self.assertEqual(self.round(), [])
        self.b_cmd("done", "SHEP-1")
        self.assertEqual(self.round(), [])

    def test_a_merge_during_an_edit_runs_once(self):
        self.b_task("Release one")
        self.auto("add", title="Update", prompt="Go.", on="merged", from_=f"vmb:{self.b_folder}")
        self.round()
        self.b_merge(1)
        # edited before A's next round: its prompt, and --from given again as it was
        self.auto("edit", id="1", prompt="Update all.", from_=f"vmb:{self.b_folder}")
        self.assertEqual([f["why"] for f in self.round()], ["merged: vmb:SHEP-1"])
        self.assertEqual(self.round(), [])
        self.assertEqual(len(self.started), 1)
        self.assertTrue(self.started[0]["prompt"].startswith("Update all."))

    def test_a_merge_during_a_scheduler_restart_runs_once(self):
        """A's scheduler down (no rounds) while B merges: its first round back runs it, once."""
        self.b_task("Release one")
        self.auto("add", title="Update", prompt="Go.", on="merged", from_=f"vmb:{self.b_folder}")
        self.round()
        self.b_merge(1)
        self.b_task("Release two", state="done", merged=True)  # added and merged while it was down
        self.assertEqual(sorted(f["why"] for f in self.round()), ["merged: vmb:SHEP-1", "merged: vmb:SHEP-2"])
        self.assertEqual(self.round() + self.round(), [])
        self.assertEqual(len(self.started), 2)

    def test_a_merge_while_no_agent_could_start_runs_once(self):
        from unittest import mock
        import herdr_task.base as base
        self.b_task("Release one")
        self.auto("add", title="Update", prompt="Go.", on="merged", from_=f"vmb:{self.b_folder}")
        self.round()
        self.b_merge(1)

        def broken(*a, **k):
            raise RuntimeError("hc: the session is down")
        # a start that breaks outright: nothing of the round is saved, so the merge is still news next round
        with mock.patch.object(self.au, "begin", broken):
            self.round()
        self.assertEqual(self.auto("show", id="1")["runs"], [])
        self.assertEqual([f["why"] for f in self.round()], ["merged: vmb:SHEP-1"])
        self.assertEqual(self.round(), [])
        self.assertEqual(len(self.started), 1)
        # a start refused (its agent can't start): one run, on record with why, never fired again
        self.b_task("Release two")
        self.round()
        self.b_merge(2)

        def refused(s, t, space):
            raise base.Fail("claude is signed out")
        with mock.patch.object(self.au, "worker_argv", refused):
            self.assertEqual([f["why"] for f in self.round()], ["merged: vmb:SHEP-2"])
        self.assertEqual(self.round() + self.round(), [])
        runs = self.auto("show", id="1")["runs"]
        self.assertEqual(len(runs), 2)
        self.assertIn("signed out", runs[-1]["error"])

    def test_show_says_when_it_last_heard(self):
        """auto show: when it last heard the machine it listens to, and that it can't hear it."""
        import datetime
        self.b_task("Fix one")
        self.auto("add", title="Update", prompt="Go.", on="merged", from_=f"vmb:{self.b_folder}")
        t0 = 1_800_000_000_000
        from unittest import mock
        with mock.patch.object(self.au, "now", lambda: t0):
            shown = self.auto("show", id="1")
            self.assertIsNone(shown["heard"])
            self.assertIn("hasn't heard from vmb yet", shown["heard_words"])
            self.round()
            shown = self.auto("show", id="1")
            self.assertEqual(shown["heard"], t0)
            self.assertTrue(shown["hearing"])
            at = f"{datetime.datetime.fromtimestamp(t0 / 1000):%H:%M}"
            self.assertEqual(shown["heard_words"], f"last heard from vmb {at}")
            self.assertIn(f"; last heard from vmb {at}", self.au.auto_line(shown))
        # the scheduler stopped asking: it says so
        with mock.patch.object(self.au, "now", lambda: t0 + 10 * 60_000):
            shown = self.auto("show", id="1")
            self.assertFalse(shown["hearing"])
            self.assertIn(f"can't hear vmb: last heard {at}", shown["heard_words"])
        # B can't be reached
        self.b_up = False
        down = t0 + 15_000
        self.round_at(down)
        with mock.patch.object(self.au, "now", lambda: down):
            shown = self.auto("show", id="1")
        self.assertFalse(shown["hearing"])
        self.assertEqual(shown["heard"], t0)
        self.assertEqual(shown["heard_words"], f"can't hear vmb since {datetime.datetime.fromtimestamp(down / 1000):%H:%M}")

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
            (aset, "run", run), (aset.reactions, "run", run),
            (aset, "coordinators", lambda: list(self.terminals)),
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
                             ("Base branch", "the folder's checked-out branch"), ("Worktrees", "on"),
                             ("Task notes", "none"), ("Before the agent starts", "none"), ("Reactions", "on"),
                             ("Feedback offers", "on (offer once to file a Shepherdr problem as an issue on eliasstravik/shepherdr")]:
            self.assertTrue(self.line(note, label).startswith(f"- {label}: {words}"), self.line(note, label))
        # nothing differs from Herdr's default: no line says who set it
        self.assertNotIn("; set for", note)
        self.assertNotIn("; your setting", note)
        self.assertEqual(len(note.split("\n")), 14)  # head, 12 lines (Suggested replies, Repo settings), the Reactions guide
        self.assertIn("- Repo settings: none (every repo has the task lines above)", note)
        self.assertIn("the task lines below are Everywhere's", note)
        self.assertIn("- Suggested replies: on (end each reply with one to three replies", note)

    def test_the_block_for_a_space_with_its_own(self):
        """SHEP-335: the task lines are the repo's the space sits on (repos[<folder>]), its own lines (Reactions) the
        space's; a space elsewhere (root on /) gets Everywhere's task lines and sees the repo's in Repo settings."""
        shop = os.path.realpath(tempfile.mkdtemp())
        self.write({"everywhere": {"tasks": {"review_rounds": 2, "merge": "checks"}, "assistant": {"reactions": True}},
                    "repos": {shop: {"tasks": {"base": "dev", "start_notes": "bun install", "max_running": 3, "worktrees": False,
                                               "setup": "ln -s ../node_modules ."},
                                     "worker": {"agent": "codex", "model": "gpt-5", "effort": "high"},
                                     "reviewer": {"agent": "claude", "model": "opus"}}},
                    "spaces": {"sp1": {"folder": shop, "assistant": {"reactions": False}},
                               "sp2": {"folder": "/", "tasks": {"merge": "auto"}}}})
        self.assistant()
        note = self.aset.session_note("t5")
        self.assertIn(f"the task lines below are {shop}'s", note)
        self.assertEqual(self.line(note, "Review"), "- Review: on, at most 2 rounds, must fix major and up (blocker, major), reviewer claude, model opus; this repo's setting")
        self.assertEqual(self.line(note, "Merge"), "- Merge: after checks (Herdr merges a ready task once all its checks pass); your setting everywhere")
        self.assertEqual(self.line(note, "Proof"), "- Proof: on")
        self.assertEqual(self.line(note, "Task agent"), "- Task agent: codex, model gpt-5, effort high; this repo's setting")
        self.assertIn("- Base branch: dev ", note)
        self.assertIn("- Worktrees: off (tasks work in the folder itself); this repo's setting", note)
        self.assertIn(f"- Repo settings: {shop}: Task agent codex, model gpt-5, effort high, Reviewer claude, model opus, Base branch dev, also", note)
        self.assertNotIn("Tasks at once", note)
        self.assertIn("- Task notes: start notes set", note)
        self.assertIn("- Before the agent starts: ln -s ../node_modules . (runs in each new worktree first", note)
        self.assertIn("- Reactions: off", note)
        self.assertIn("never react", note.split("\n")[-1])
        self.assertNotIn("👀", note)
        labels = self.terminals["t5"]["labels"]
        self.assertEqual(labels["herdr.reactions"], "off")
        self.assertEqual(sorted(self.aset.parse(labels["herdr.settings"])),
                         sorted(["review", "merge", "proof", "agent", "base", "worktrees", "notes", "setup", "reactions", "suggestions", "feedback", "repos"]))
        # a space on / (root), its file not moved yet: its task values are the / folder's, not the shop repo's
        self.assistant("t6", "sp2")
        other = self.aset.session_note("t6")
        self.assertIn("- Merge: on its own (Herdr merges a ready task at once, waiting only on checks its base branch requires); this repo's setting", other)
        self.assertIn("the task lines below are /'s", other)
        self.assertIn(f"- Repo settings: {shop}: ", other)
        # moved (repos), root sits on no repo of its own: Everywhere's task lines, and the repos listed with theirs
        self.write({"everywhere": {"tasks": {"merge": "checks"}}, "repos": {shop: {"tasks": {"merge": "auto"}}},
                    "spaces": {"sp2": {"folder": "/"}}})
        other = self.aset.session_note("t6")
        self.assertIn("- Merge: after checks (Herdr merges a ready task once all its checks pass); your setting everywhere", other)
        self.assertIn("the task lines below are Everywhere's", other)
        self.assertIn(f"- Repo settings: {shop}: Merge on its own\n", other)
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

    def test_old_instructions_are_ignored_and_a_told_assistant_hears_once_they_are_gone(self):
        """SHEP-319: Settings › Instructions is gone. A file still holding them (or a stored Autopilot or Tasks-at-once)
        breaks nothing and none of it reaches the block; an Assistant told some before is told once they no longer
        apply, one never told any hears nothing."""
        self.write({"everywhere": {"instructions": "Write British English.", "autopilot": {"every": "every 30 minutes"}, "tasks": {"max_running": 2}},
                    "spaces": {"sp1": {"instructions": "This shop sells tea."}, "sp2": {"autopilot": {"direction": "x"}}}})
        self.assistant()
        note = self.aset.session_note("t5")
        for gone in ("Autopilot", "Tasks at once", "nstructions", "British", "sells tea"):
            self.assertNotIn(gone, note)
        self.assertNotIn("instructions", self.aset.parse(self.terminals["t5"]["labels"]["herdr.settings"]))
        # two running Assistants labelled by an older herdr-task: t5 was told some, t6 none
        import hashlib
        told = self.aset.parse(self.terminals["t5"]["labels"]["herdr.settings"])
        self.terminals["t5"]["labels"]["herdr.settings"] = ",".join(f"{k}:{v}" for k, v in {**told, "instructions": hashlib.sha1(b"x").hexdigest()[:6]}.items())
        self.assistant("t6", "sp2")
        self.aset.session_note("t6")
        self.terminals["t6"]["labels"]["herdr.settings"] += f",instructions:{self.aset.NO_INSTRUCTIONS}"
        self.aset.settings_pass({}, {})
        self.assertEqual([a for a, _ in self.sent], ["t5"])
        self.assertIn('<herdr-setting name="instructions" value="off"', self.sent[0][1])
        self.assertIn(self.aset.INSTRUCTIONS_GONE, self.sent[0][1])
        self.assertIn(self.aset.NOTICE_END, self.sent[0][1])
        self.write({"everywhere": {"instructions": "Write American English."}})
        self.aset.settings_pass({}, {})
        self.assertEqual(len(self.sent), 1)  # once; a changed old key says nothing

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
        shop = os.path.realpath(tempfile.mkdtemp())
        self.write({"everywhere": {"tasks": {"merge": "checks"}, "worker": {"agent": "codex"}},
                    "spaces": {"sp1": {"folder": shop, "worker": {"agent": "claude", "model": "opus"}}}})
        self.aset.settings_pass({}, {})
        self.assertEqual(len(self.sent), 1)  # only the last: sp1's repo's own agent (a file not moved yet: the space's)
        self.assertIn('name="agent" value="claude/opus" scope="repo"', self.sent[0][1])
        self.write({"everywhere": {"tasks": {"merge": "checks"}, "worker": {"agent": "codex"}},
                    "spaces": {"sp1": {"folder": shop, "worker": {"agent": "claude", "model": "opus"}}}})
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
        rs = self.aset.rows("sp1", {})
        for line in self.aset.notice(rs).split("\n"):
            self.assertRegex(line, r'^<herdr-setting name="\w+" value="[^"]*" scope="\w+">[^\n]*</herdr-setting>$')


class NoStarPrompt(unittest.TestCase):
    """SHEP-225 (#981): the one-time "Enjoying Shepherdr?" GitHub star card (SHEP-79) is gone: no command, no module,
    no words in the Assistant's instructions; a settings file still holding its star_prompt reads as before."""

    def test_gone(self):
        self.assertFalse(os.path.exists(os.path.join(BIN, "herdr_task", "star.py")))
        r = subprocess.run([sys.executable, os.path.join(BIN, "herdr-task"), "star", "check"], capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("invalid choice", r.stderr)
        with open(os.path.join(ROOT, "templates", "assistant.md")) as f:
            words = f.read()
        self.assertNotRegex(words, r"herdr-task star\b|Enjoying Shepherdr|GitHub star")

    def test_an_old_settings_file_still_loads(self):
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.settings as settings
        path = os.path.join(tempfile.mkdtemp(), "settings.json")
        with open(path, "w") as f:
            json.dump({"version": 1, "everywhere": {"star_prompt": {"asked": 1, "answer": "no"}, "tasks": {"merge": "checks"}}}, f)
        with mock.patch.object(settings, "SETTINGS", path):
            d = settings.read_settings()
        self.assertEqual(d["everywhere"]["tasks"]["merge"], "checks")


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
        self.assertRegex(text, r'^<herdr-news task="SHEP-7" event="feedback" key="[0-9a-f]{10}">"Fix login" feedback: The Accept card shows an empty diff · '
                               r'Goal: accept SHEP-7\. Expected: its 3 files\.</herdr-news>$')
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
        self.assertIn('"Leave feedback for Shepherdr about Ready refuses a reviewed commit?"', out)
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
        self.assertIn("eliasstravik/shepherdr", self.gh[0])  # the default repo
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
        for words in ("- Shepherdr: 3.1.12", "- Agent CLI: Claude Code 0.9.1", "- Used from: the web app", "1. Start a task", "… (cut)"):
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

    def test_every_role_is_told(self):
        from herdr_task import templates, reactions
        with open(os.path.join(ROOT, "templates", "assistant.md")) as f:
            a = f.read()
        for words in ("## Feedback for Shepherdr", "Leave feedback for Shepherdr about", "--no", "duplicate", "--comment", "in the middle of something urgent"):
            self.assertIn(words, a)
        with open(os.path.join(ROOT, "templates", "worker.md")) as f:
            self.assertIn(templates.FEEDBACK_RULE.strip(), f.read())
        self.assertIn(templates.FEEDBACK_RULE, templates.WORKER_MD)
        self.assertIn(templates.WORKER_MD_BEFORE_FEEDBACK, templates.OLD_WORKERS)
        with open(os.path.join(ROOT, "templates", "reviewer.md")) as f:
            self.assertIn(templates.REVIEWER_FEEDBACK.strip(), f.read())
        self.assertIn("herdr-task feedback", self.fb.AGENT_NOTE)
        self.assertIn("feedback", __import__("herdr_task.launch", fromlist=["OWN"]).OWN)


class CodexAsksOnTheCard(unittest.TestCase):
    """SHEP-91: a Codex worker's PermissionRequest hook (`herdr-task _allow`) allows its own commands, and hands anything
    else to the chat's card (ask-hook.sh, marked HERDR_ASK_CHAINED), waiting as long as the card does."""

    def run_allow(self, command, hook, home=None, auto_review=False):
        app = tempfile.mkdtemp()   # Shepherdr's own folder (SHARE) for this run
        if hook is not None:
            os.makedirs(os.path.join(app, "hooks"))
            with open(os.path.join(app, "hooks", "ask-hook.sh"), "w") as f:
                f.write(hook)
        code = ("import sys, types, argparse; sys.dont_write_bytecode = True; sys.path.insert(0, sys.argv[1]);"
                "from herdr_task.launch import cmd_allow; cmd_allow(argparse.Namespace(command='/x/herdr-task', auto_review=sys.argv[2] == '1'))")
        req = json.dumps({"tool_name": "Bash", "tool_input": {"command": command}, "turn_id": "t1"})
        # its own SHARE and HOME: else cmd_allow would run this checkout's hooks/ask-hook.sh, or fall back to
        # ~/.local/share/herdr/ask's copy, and the real one files a real card for this test and waits on it forever (SHEP-147)
        env = {**os.environ, "SHEPHERDR_SHARE": app, "HOME": home or app}
        env.pop("HERDR_ASK_CHAINED", None)
        return subprocess.run([sys.executable, "-c", code, BIN, "1" if auto_review else "0"], input=req, capture_output=True, text=True, env=env)

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

    def test_approve_for_me_leaves_the_rest_to_codex_review(self):
        """#1464: a worker on Codex's Approve for me. Codex runs this hook before its own review (checked on 0.163.0:
        no decision here, its review then allowed a plain network call and refused sending a file out), so the card
        is never asked; its own commands are still allowed at once."""
        card = 'echo \'{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"card"}}}\''
        self.assertEqual(self.run_allow("curl -sI https://example.com", card, auto_review=True).stdout, "")
        out = self.run_allow("/x/herdr-task status SHEP-1 hi", card, auto_review=True)
        self.assertEqual(json.loads(out.stdout)["hookSpecificOutput"]["decision"], {"behavior": "allow"}, out.stderr)
        sys.path.insert(0, BIN)
        from herdr_task import launch, settings, flags
        argv = launch.own_argv(settings.argv_for({"agent": "codex", "perm": "approve"}))
        hook = next(a for a in argv if a.startswith("hooks.PermissionRequest="))
        self.assertIn(" --auto-review", hook)
        self.assertIn("--approve-for-me", argv)
        self.assertNotIn("workspace-write", argv)
        self.assertNotIn("--auto-review", next(a for a in launch.own_argv(["codex", "-s", "workspace-write"]) if a.startswith("hooks.PermissionRequest=")))
        # read back, and carried across: Claude's nearest is its auto mode
        self.assertEqual(settings.argv_perm(argv), "approve")
        self.assertEqual(settings.perm_across("approve", "claude"), "auto")
        self.assertEqual(settings.perm_across("approve", "codex"), "approve")
        # it's a permission pick, not an extra flag
        for bad in ("--approve-for-me", "-c approvals_reviewer=auto_review"):
            with self.assertRaises(Exception) as e:
                flags.parse("codex", bad)
            self.assertIn("Approve for me", str(e.exception))
        # the command Codex runs, as written: no decision, no card
        env = {**os.environ, "SHEPHERDR_SHARE": tempfile.mkdtemp(), "HOME": tempfile.mkdtemp()}
        import shlex
        r = subprocess.run(shlex.split(launch.ask_command("/x/herdr-task", sandboxed=True, auto_review=True)),
                           input=json.dumps({"tool_name": "Bash", "tool_input": {"command": "curl x"}}), capture_output=True, text=True, env=env)
        self.assertEqual((r.returncode, r.stdout), (0, ""), r.stderr)

    def test_without_an_app_hook_the_synced_copy_answers(self):
        """SHEP-147: a machine that only runs tasks has no install of its own; cmd_allow falls back to the copy a sync left in
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
        # no Shepherdr install here: the copy a sync left in ~/.local/share/herdr/ask is the card's hook
        home = tempfile.mkdtemp()
        os.makedirs(os.path.join(home, ".local", "share", "herdr", "ask"))
        hook = os.path.join(home, ".local", "share", "herdr", "ask", "ask-hook.sh")
        with open(hook, "w") as f:
            f.write("exit 0\n")
        code = ("import sys; sys.dont_write_bytecode = True; sys.path.insert(0, sys.argv[1]);"
                "from herdr_task.launch import ask_hook; print(ask_hook())")
        env = {**os.environ, "HOME": home, "SHEPHERDR_SHARE": os.path.join(home, "none")}
        out = subprocess.run([sys.executable, "-c", code, BIN], capture_output=True, text=True, env=env)
        self.assertEqual(out.stdout.strip(), hook, out.stderr)
        # Shepherdr's own install has one: that one first
        own = os.path.join(home, "share", "hooks", "ask-hook.sh")
        os.makedirs(os.path.dirname(own))
        open(own, "w").close()
        out = subprocess.run([sys.executable, "-c", code, BIN], capture_output=True, text=True, env={**env, "SHEPHERDR_SHARE": os.path.join(home, "share")})
        self.assertEqual(out.stdout.strip(), own, out.stderr)

    def test_the_install_folder_is_found_from_where_herdr_task_lives(self):
        """3.2: the hook, the install record and the rest of Shepherdr's own folder are beside this herdr-task
        (<SHARE>/mods/tasks/bin/herdr_task): in a checkout the repo, installed ~/.local/share/shepherdr; a lone
        zipapp (a sync's copy in ~/.local/bin) has none beside it and looks in ~/.local/share/shepherdr."""
        code = ("import sys; sys.dont_write_bytecode = True; sys.path.insert(0, sys.argv[1]);"
                "from herdr_task import base, launch; print(base.SHARE); print(launch.ask_hook())")
        env = {k: v for k, v in os.environ.items() if k != "SHEPHERDR_SHARE"}
        out = subprocess.run([sys.executable, "-c", code, BIN], capture_output=True, text=True, env=env)
        self.assertEqual(out.stdout.split(), [ROOT, os.path.join(ROOT, "hooks", "ask-hook.sh")], out.stderr)
        home = tempfile.mkdtemp()
        zipped = os.path.join(home, ".local", "bin", "herdr-task")
        os.makedirs(os.path.dirname(zipped))
        sys.path.insert(0, BIN)
        from herdr_task import base
        with open(zipped, "wb") as f:
            f.write(base.bundle())
        code = "import sys; sys.path.insert(0, sys.argv[1]); from herdr_task import base; print(base.SHARE)"
        out = subprocess.run([sys.executable, "-c", code, zipped], capture_output=True, text=True, env={**env, "HOME": home})
        self.assertEqual(out.stdout.strip(), os.path.join(home, ".local", "share", "shepherdr"), out.stderr)

    def test_a_sync_takes_the_card_hook_along(self):
        sys.path.insert(0, BIN)
        from herdr_task import machines
        app = tempfile.mkdtemp()
        os.makedirs(os.path.join(app, "hooks"))
        for name in ("ask-hook.sh", "ask-end.py"):
            with open(os.path.join(app, "hooks", name), "w") as f:
                f.write(f"# {name}\n")
        from unittest import mock
        with mock.patch.object(machines, "SHARE", app):
            files = {f["path"]: f for f in machines.manifest()["files"]}
        self.assertEqual(files[".local/share/herdr/ask/ask-hook.sh"]["data"], b"# ask-hook.sh\n")
        self.assertEqual(files[".local/share/herdr/ask/ask-hook.sh"]["mode"], 0o755)
        self.assertIn(".local/share/herdr/ask/ask-end.py", files)

    def test_a_sync_takes_the_browser_and_the_desktop_along(self):
        sys.path.insert(0, BIN)
        from herdr_task import machines
        from unittest import mock
        here = tempfile.mkdtemp()
        for name in ("herdr-browser", "herdr-desktop"):
            with open(os.path.join(here, name), "w") as f:
                f.write(f"#!/bin/sh\n# {name}\n")
        real = lambda rel: os.path.join(here, os.path.basename(rel)) if os.path.basename(rel) in ("herdr-browser", "herdr-desktop") else None  # noqa: E731
        with mock.patch.object(machines, "_real", real):
            files = {f["path"]: f for f in machines.manifest()["files"]}
        for name in ("herdr-browser", "herdr-desktop"):
            self.assertEqual(files[f".local/bin/{name}"]["data"], f"#!/bin/sh\n# {name}\n".encode())
            self.assertEqual(files[f".local/bin/{name}"]["mode"], 0o755)
        with mock.patch.object(machines, "_real", lambda rel: None):  # a machine without them passes none on
            self.assertFalse([f for f in machines.manifest()["files"] if "herdr-desktop" in f["path"] or "herdr-browser" in f["path"]])

    def test_its_desktop_never_asks_as_its_browser(self):
        """3.2: a worker's herdr-desktop commands are its own, as herdr-browser's: by bare name or the path on PATH, in
        Claude's allow rules and in the hook's answer; not where there is none, and nothing chained."""
        sys.path.insert(0, BIN)
        from unittest import mock
        from herdr_task import launch
        which = lambda n: {"herdr-browser": "/b/herdr-browser", "herdr-desktop": "/b/herdr-desktop"}.get(n)  # noqa: E731
        own = lambda c: launch.own_command("/x/herdr-task", c)  # noqa: E731
        with mock.patch.object(launch.shutil, "which", which), mock.patch.object(launch, "browser_path", lambda: "/b/herdr-browser"), \
                mock.patch.object(launch, "desktop_path", lambda: "/b/herdr-desktop"):
            for c in ("herdr-desktop snapshot", "/b/herdr-desktop click @e3", "herdr-desktop hands 'a sign-in code'", "herdr-browser snapshot -i"):
                self.assertTrue(own(c), c)
            for c in ("herdr-desktop", "/elsewhere/herdr-desktop snapshot", "herdr-desktop snapshot && rm -rf build"):
                self.assertFalse(own(c), c)
            self.assertEqual(launch.tool_name("/b/herdr-desktop", "/x/herdr-task"), "@herdr-desktop")
            rules = launch.own_rules("/x/herdr-task")
            for r in ("Bash(/b/herdr-desktop:*)", "Bash(herdr-desktop:*)", "Bash(/b/herdr-browser:*)"):
                self.assertIn(r, rules)
        with mock.patch.object(launch.shutil, "which", which), mock.patch.object(launch, "browser_path", lambda: "/b/herdr-browser"), \
                mock.patch.object(launch, "desktop_path", lambda: None):
            self.assertFalse(own("herdr-desktop snapshot"))
            self.assertFalse([r for r in launch.own_rules("/x/herdr-task") if "herdr-desktop" in r])
        self.assertIn("herdr-desktop's (your desktop)", open(os.path.join(BIN, "herdr_task", "launch.py")).read())

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
                   "hc run --bg --name demo-1-review -- claude --permission-mode dontAsk --tools=Read,Grep,Glob,Bash --strict-mcp-config --model opus 'review'",
                   f"hc run --bg --name demo-1-review -- {reviewer_command('claude', 'opus', 'high')} 'review'",
                   "hc wait demo-1-review --timeout 600", "hc read demo-1-review --lines 400", "hc kill demo-1-review",
                   "hc keys demo-1-review enter", "hc keys demo-1-review down enter"]
            no = ["hc run --bg --name demo-1-review -- claude --permission-mode dontAsk --tools=Read,Grep,Glob,Bash --dangerously-skip-permissions x",
                  "hc run --bg --name demo-1-review -- claude --permission-mode dontAsk --tools=Read,Grep,Glob,Bash,Edit x",
                  "hc run --bg --name demo-1-review -- claude --permission-mode plan x",
                  "hc run --bg --name demo-1-review -- env \"CLAUDE_CONFIG_DIR=$HOME\" claude --permission-mode dontAsk --tools=Read,Grep,Glob,Bash x",
                  "hc run --bg --name demo-1-review -- codex --no-daemon --sandbox read-only --ask-for-approval never "
                  "-c sandbox_mode=\"danger-full-access\" x",
                  "hc run --bg --name demo-1-review -- sh -c 'rm -rf /'", "hc run --bg --name x -- claude --permission-mode dontAsk --tools=Read,Grep,Glob,Bash x",
                  "hc kill t15q", "hc send demo-1-review hi", "hc keys t15q enter", "hc keys demo-1-review --text 'rm -rf /'"]
            for c in yes:
                self.assertTrue(own(c), c)
            for c in no:
                self.assertFalse(own(c), c)
            self.assertFalse(own(yes[3], False))
        argv = launch.own_argv(["codex", "-s", "workspace-write"])
        self.assertIn(" _allow --command ", argv[2])
        self.assertIn(" --sandboxed", argv[2])
        claude = json.loads(launch.own_argv(["claude", "go"])[2])["hooks"]["PermissionRequest"][0]["hooks"][0]["command"]
        self.assertNotIn("--sandboxed", claude)

    def test_a_tool_by_its_full_path_is_the_same_tool(self):
        """#1098: a Codex worker's `/…/hc read <its reviewer>` asked (and hung on the card) where the bare `hc read`
        ran at once. A tool written by its full path, or herdr-task by its bare name when PATH's is this one, matches."""
        sys.path.insert(0, BIN)
        from unittest import mock
        from herdr_task import launch
        d = tempfile.mkdtemp()
        tools = {}
        for name in ("hc", "herdr-artifact", "herdr-task"):
            tools[name] = os.path.join(d, name)
            open(tools[name], "w").close()
        os.symlink(tools["hc"], os.path.join(d, "hc-link"))
        with mock.patch.object(launch.shutil, "which", lambda n: tools.get(n)), \
                mock.patch.dict(os.environ, {"HERDR_BROWSER_TASK": "demo#1"}):
            own = lambda c, sb=True: launch.own_command(tools["herdr-task"], c, sb)  # noqa: E731
            for c in (f"{d}/hc read demo-1-review --lines 400", f"{d}/hc-link wait demo-1-review --timeout 600",
                      "hc get demo-1-review --json", f"{d}/herdr-artifact publish /tmp/p", "herdr-task status SHEP-1 hi",
                      f"{d}/herdr-task ready SHEP-1 --summary hi"):
                self.assertTrue(own(c), c)
            for c in ("/tmp/evil/hc read demo-1-review", f"{d}/hc send demo-1-review hi", "/tmp/evil/herdr-task status x",
                      f"{d}/hc read t15q", "/tmp/x/git commit -m x"):
                self.assertFalse(own(c), c)
            # herdr-task on PATH that isn't this one: its bare name isn't this launch's
            self.assertFalse(launch.own_command("/elsewhere/herdr-task", "herdr-task status SHEP-1 hi", True))

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

    def test_a_codex_worker_never_stops_on_shepherdrs_own_hooks(self):
        """#977: Shepherdr's chat hooks in ~/.codex/hooks.json, new or updated, stopped a resumed Codex worker at
        "Hooks need review" while the task showed Working. Its launch trusts exactly those, as Codex hashes them
        (the hash below is what real Codex 0.163 wrote to config.toml on "Trust all")."""
        sys.path.insert(0, BIN)
        from unittest import mock
        from herdr_task import launch
        home = tempfile.mkdtemp()
        note = "sh '/x/mods/chat/session-note.sh'"
        with open(os.path.join(home, "hooks.json"), "w") as f:
            json.dump({"hooks": {"SessionStart": [{"hooks": [{"type": "command", "command": note, "timeout": 10}]}],
                                 "PermissionRequest": [{"hooks": [{"type": "command", "command": "sh mine.sh", "timeout": 5}]},
                                                       {"hooks": [{"type": "command", "command": "sh '/x/mods/chat/ask-hook.sh'",
                                                                   "timeout": 1800}]}]}}, f)
        with mock.patch.dict(os.environ, {"CODEX_HOME": home}):
            argv = launch.own_argv(["codex", "-s", "workspace-write"])
        [state] = [a for a in argv if str(a).startswith("hooks.state=")]
        self.assertIn('%s={trusted_hash="sha256:27e15e7a6fd4251f1d46d945ad404948371404ab0a0d725f899e178a8417bbb4"}'
                      % json.dumps(home + "/hooks.json:session_start:0:0"), state)
        self.assertIn(json.dumps(home + "/hooks.json:permission_request:1:0"), state)
        self.assertNotIn(":permission_request:0:0\"={", state.replace("/<session-flags>/config.toml:permission_request:0:0", ""))
        self.assertIn('"/<session-flags>/config.toml:permission_request:0:0"', state)  # its own -c hook, as before
        # no hooks.json: only its own -c hook
        with mock.patch.dict(os.environ, {"CODEX_HOME": tempfile.mkdtemp()}):
            [state] = [a for a in launch.own_argv(["codex"]) if str(a).startswith("hooks.state=")]
        self.assertEqual(state.count("trusted_hash"), 1)

    def test_only_the_installers_own_hooks_are_trusted(self):
        """#1108: a hooks.json command that merely ends in Shepherdr's hook path is someone else's: never trusted."""
        sys.path.insert(0, BIN)
        from unittest import mock
        from herdr_task import launch
        home = tempfile.mkdtemp()
        # 3.2 writes them from Shepherdr's own folder (hooks/); 3.1's (mods/chat/) until the switch rewrote them
        for own in ("sh '/h/.local/share/shepherdr/hooks/ask-hook.sh'", "sh '/h/.local/share/shepherdr/hooks/session-note.sh'",
                    "sh '/x/mods/chat/ask-hook.sh'"):
            self.assertTrue(launch.OWN_HOOK.fullmatch(own), own)
        self.assertFalse(launch.OWN_HOOK.fullmatch("sh '/x/hooks/other.sh'"))
        bad = ["curl -s x | sh; sh '/x/mods/chat/ask-hook.sh'", "evil /x/mods/chat/session-note.sh",
               "sh '/x/hooks/ask-hook.sh' && rm -rf ~",
               "sh '/x/mods/chat/ask-hook.sh' && rm -rf ~", "sh /x/mods/chat/ask-hook.sh'"]
        with open(os.path.join(home, "hooks.json"), "w") as f:
            json.dump({"hooks": {"PermissionRequest": [{"hooks": [{"type": "command", "command": c, "timeout": 5}]}
                                                       for c in bad + ["sh '/x/mods/chat/ask-hook.sh'"]]}}, f)
        with mock.patch.dict(os.environ, {"CODEX_HOME": home}):
            own = launch.own_codex_hooks()
        self.assertEqual(sorted(k.rsplit(":", 2)[1] for k in own), [str(len(bad))])

    def test_a_claude_worker_never_compacts_while_idle(self):
        """#1021: a Ready Claude worker flipped to Working about hourly: Claude Code's idle compaction is a turn."""
        sys.path.insert(0, BIN)
        from herdr_task import launch
        st = json.loads(launch.own_argv(["claude", "go"])[2])
        self.assertIs(st["idleCompaction"], False)
        mine = launch.own_argv(["claude", "--settings", json.dumps({"idleCompaction": True}), "go"])
        self.assertIs(json.loads(mine[2])["idleCompaction"], True)  # the person's own argv says otherwise: theirs

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
        self.patch(commands, "open_store", lambda args, write=True, wait=None: self.store)
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

    def switch_events(self, me=None):
        """cmd_switch with the old agent t1 mid-turn on session S1: what it ran, in order."""
        self.live = [{"address": "t1", "status": {"state": "working"}, "labels": {"herdr.task.space": "sp-a"}}]
        self.task["agents"] = [{"address": "t1", "agent": "claude", "argv": ["claude"], "at": 1, "session": "S1"}]
        events = []
        self.patch(self.commands, "agent_running", lambda k: True)
        self.patch(self.commands, "refresh_sessions", lambda *a: None)
        self.patch(self.commands, "stop_note", lambda *a, **k: None)
        self.patch(self.commands, "unarchive", lambda *a: None)
        self.patch(self.commands, "parent_for", lambda parent, space: parent)
        self.patch(self.commands, "run", lambda argv, **k: events.append(("run", argv)))

        def launch(s, t, argv, space, message=None, parent=None, resume=None, role=None):
            events.append(("launch", resume, message))
            return {"address": "t2", "agent": "claude", "argv": argv}
        self.patch(self.commands, "launch", launch)
        env = {k: v for k, v in os.environ.items() if k != "HC_TERMINAL_ID"}
        if me:
            env["HC_TERMINAL_ID"] = me
        with self.mock.patch.dict(os.environ, env, clear=True):
            self.commands.cmd_switch(self.args(space=None, agent=None, argv='["claude", "--model", "opus"]', parent=None,
                                               keep=False))
        return events

    def test_switch_ends_the_old_agent_before_resuming_its_session(self):
        """SHEP-211: switch resumed the old agent's session while the old agent was mid-turn, then killed it: the
        new agent sat on "Interrupted" with no message (a false "needs you"). Now the old one ends first, and the
        resumed session gets a first message to carry on."""
        events = self.switch_events()
        self.assertEqual(events[0], ("run", ["hc", "kill", "t1"]))
        self.assertEqual([e[0] for e in events], ["run", "launch"])
        _, resume, message = events[1]
        # #1056: the mode a new session would get (none set on this home: default), not the old session's
        self.assertEqual(resume, ["claude", "--model", "opus", "--permission-mode", "default", "--resume", "S1"])
        self.assertEqual(message, self.commands.SWITCH_NUDGE)
        self.assertEqual(self.said[-1], '"Flow": claude t2 resumed its session, t1 ended')

    def test_a_resumed_claude_starts_in_the_configured_mode(self):
        """#1056: Claude Code resumes a session in the permission mode it ended in (a stuck agent left in plan or
        ask came back so after switch). The resume says the mode a new session gets: argv's own, else its
        --settings', the folder's settings, then the person's ~/.claude/settings.json."""
        from herdr_task import launch
        from unittest import mock
        d = tempfile.mkdtemp()
        home, folder = os.path.join(d, "claude"), os.path.join(d, "repo")
        os.makedirs(home)
        os.makedirs(os.path.join(folder, ".claude"))
        with open(os.path.join(home, "settings.json"), "w") as f:
            json.dump({"permissions": {"defaultMode": "auto"}}, f)
        with mock.patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": home}):
            self.assertEqual(launch.resume_argv(["claude"], "S1", folder), ["claude", "--permission-mode", "auto", "--resume", "S1"])
            with open(os.path.join(folder, ".claude", "settings.json"), "w") as f:
                json.dump({"permissions": {"defaultMode": "acceptEdits"}}, f)
            self.assertEqual(launch.resume_argv(["claude"], "S1", folder)[1:3], ["--permission-mode", "acceptEdits"])
            argv = ["claude", "--settings", json.dumps({"permissions": {"defaultMode": "plan"}})]
            self.assertEqual(launch.resume_argv(argv, "S1", folder)[3:5], ["--permission-mode", "plan"])
            # said already: kept as it is
            for argv in (["claude", "--permission-mode", "bypassPermissions"], ["claude", "--dangerously-skip-permissions"]):
                self.assertEqual(launch.resume_argv(argv, "S1", folder), argv + ["--resume", "S1"])
        # Codex's sandbox is in its argv already
        self.assertEqual(launch.resume_argv(["codex", "-s", "read-only"], "S1"), ["codex", "resume", "-s", "read-only", "S1"])

    def test_a_dont_ask_default_never_starts_a_worker(self):
        """#1110: the person's defaultMode dontAsk started every worker (a switch's too) refusing each edit, command and
        question card. A worker starts in the default mode instead (it asks on its card), and its start says so; a mode
        its own argv says stays."""
        from herdr_task import launch
        from unittest import mock
        d = tempfile.mkdtemp()
        home, folder = os.path.join(d, "claude"), os.path.join(d, "repo")
        os.makedirs(home)
        os.makedirs(folder)
        with open(os.path.join(home, "settings.json"), "w") as f:
            json.dump({"permissions": {"defaultMode": "dontAsk"}}, f)
        with mock.patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": home}):
            self.assertTrue(launch.dont_ask_default(["claude"], folder))
            argv = launch.own_argv(["claude", "go"], folder)
            self.assertEqual(argv[argv.index("--permission-mode") + 1], "default")
            # once: its argv given again (revive, a resume) adds no second flag
            self.assertEqual(launch.own_argv(argv, folder).count("--permission-mode"), 1)
            self.assertEqual(launch.resume_argv(["claude"], "S1", folder), ["claude", "--permission-mode", "default", "--resume", "S1"])
            for argv in (["claude", "--permission-mode", "dontAsk"], ["claude", "--dangerously-skip-permissions"], ["codex"]):
                self.assertFalse(launch.dont_ask_default(argv, folder), argv)
            a = launch.own_argv(["claude", "--permission-mode", "auto"], folder)
            self.assertEqual(a[a.index("--permission-mode") + 1], "auto")
            with open(os.path.join(home, "settings.json"), "w") as f:
                json.dump({"permissions": {"defaultMode": "auto"}}, f)
            self.assertFalse(launch.dont_ask_default(["claude"], folder))
            self.assertNotIn("--permission-mode", launch.own_argv(["claude", "go"], folder))

    def test_an_agent_switching_itself_ends_after_the_new_one_starts(self):
        """SHEP-211: ending the caller first would end the switch command with it."""
        events = self.switch_events(me="t1")
        self.assertEqual([e[0] for e in events], ["launch", "run"])
        self.assertEqual(events[1], ("run", ["hc", "kill", "t1"]))

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
        self.assertIn("- Suggested replies: on (your reply ends with one to three replies the person would likely send next",
                      settings.settings_block(self.store, self.task))
        settings = self.settings({"everywhere": {"agents": {"suggestions": False}}})
        self.assertIn("- Suggested replies: off (no suggested replies) (your setting everywhere)",
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

    def test_a_broken_codex_sandbox_is_in_the_brief(self):
        """SHEP-227 (#998): Codex's sandbox can't start here: a Codex worker's or reviewer's brief says so and why, and
        tells it to leave the sandbox on and tell the person. A Claude-only task, or a sandbox that starts, says nothing."""
        import herdr_task.sandbox as sandbox
        settings = self.settings({})
        broken = {"error": "bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted", "bwrap": "/usr/bin/bwrap", "userns": True}
        self.patch(sandbox, "check", lambda fresh=False: broken)
        self.assertNotIn("- Sandbox:", settings.settings_block(self.store, self.task, argv=["claude"]))
        block = settings.settings_block(self.store, self.task, argv=["codex", "--no-daemon", "-s", "workspace-write"])
        self.assertIn("- Sandbox: Codex's sandbox can't start on this machine (bwrap: loopback: Failed RTM_NEWADDR", block)
        self.assertIn("Don't loosen the sandbox yourself: tell the person", block)
        # full access runs no sandbox: nothing to say
        self.assertNotIn("- Sandbox:", settings.settings_block(self.store, self.task,
                                                                argv=["codex", "--dangerously-bypass-approvals-and-sandbox"]))
        # a Claude worker with a Codex reviewer: the review can't read files, so it is said too
        self.settings({"everywhere": {"tasks": {"review_rounds": 1}, "reviewer": {"agent": "codex"}}})
        self.assertIn("- Sandbox: Codex's sandbox", settings.settings_block(self.store, self.task, argv=["claude"]))
        self.patch(sandbox, "check", lambda fresh=False: None)
        self.assertNotIn("- Sandbox:", settings.settings_block(self.store, self.task, argv=["codex", "--no-daemon"]))

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

    def lines_file(self, cwd, name, lines, words):
        with open(os.path.join(cwd, name), "w") as f:
            f.write("".join(f"{x}\n" for x in lines))
        self.git(cwd, "add", name)
        self.git(cwd, "commit", "-q", "-m", words)
        return self.git(cwd, "rev-parse", "HEAD")

    def test_the_same_own_changes_on_a_newer_base_need_no_round(self):
        """#1178: a reviewed branch moved onto a newer base (here a rebase, which no merge walk sees) changes
        what it changed before: its review holds. Something of its own since still needs a round."""
        wt = self.reviewed_task()
        self.commit(self.main, "another task", "b.txt")
        self.git(wt, "rebase", "-q", "main")
        self.assertIsNone(self.refusal())
        self.commit(wt, "a fix of its own", "a.txt")
        self.assertIn("isn't reviewed", self.refusal())

    def test_a_conflict_resolved_keeping_both_sides_needs_no_round(self):
        """#1178: merging main hit a conflict next to the task's lines; resolved by keeping both, the task adds and
        takes away the same lines as reviewed. Dropping main's line instead is a change of its own."""
        wt = self.task["worktree"]
        self.settings({"everywhere": {"tasks": {"review_rounds": 3}}})
        self.task["review_gate"] = True
        self.lines_file(self.main, "a.txt", ["one", "two", "three", "four"], "lines")
        self.git(wt, "merge", "-q", "--no-edit", "main")
        head = self.lines_file(wt, "a.txt", ["one", "TWO", "three", "four"], "the task's line")
        self.task["reviews"] = [{"round": 1, "result": "report", "at": 2, "head": head}]
        self.lines_file(self.main, "a.txt", ["one", "two", "THREE", "four"], "main's line")
        self.assertNotEqual(subprocess.run(["git", "-C", wt, "merge", "-q", "--no-edit", "main"], capture_output=True).returncode, 0)
        self.lines_file(wt, "a.txt", ["one", "TWO", "THREE", "four"], "merged main, both kept")
        self.assertIsNone(self.refusal())
        self.git(wt, "reset", "-q", "--hard", head)
        subprocess.run(["git", "-C", wt, "merge", "-q", "--no-edit", "main"], capture_output=True)
        self.lines_file(wt, "a.txt", ["one", "TWO", "three", "four"], "merged main, its line dropped")
        self.assertIn("isn't reviewed", self.refusal())

    def test_reviewed_spends_no_round_on_a_clean_merge(self):
        """#1178: out of rounds, an agent that merged main ran `reviewed` again, was refused and waited for its
        Assistant's review-more. A commit that only adds the base to a reviewed one is said so, with no round used."""
        import argparse
        wt = self.reviewed_task()
        self.task["reviews"] += [{"round": 2, "result": "report", "at": 3, "head": self.task["reviews"][0]["head"]},
                                 {"round": 3, "result": "report", "at": 4, "head": self.task["reviews"][0]["head"]}]
        self.commit(self.main, "another task", "b.txt")
        self.git(wt, "merge", "-q", "--no-edit", "main")
        self.commands.cmd_reviewed(argparse.Namespace(id="SHEP-1", json=True, folder=None, report="", commit=None))
        self.assertEqual(len(self.task["reviews"]), 3)
        self.assertIn("its review holds, no round used", self.said[-1])
        self.commit(wt, "a fix of its own", "a.txt")
        with self.assertRaises(self.commands.Fail):
            self.commands.cmd_reviewed(argparse.Namespace(id="SHEP-1", json=True, folder=None, report="", commit=None))

    def test_a_fix_after_the_last_round_asks_for_one_more(self):
        """#951: the fix of the last round's findings was refused, and the Assistant had told the worker to just
        say ready. The refusal and the Assistant's guide both say that fix needs a round of its own (review-more)."""
        wt = self.reviewed_task()
        head = self.task["reviews"][0]["head"]
        self.task["reviews"] += [{"round": 2, "result": "report", "at": 3, "head": head},
                                 {"round": 3, "result": "report", "at": 4, "head": head}]
        self.commit(wt, "fix round 3's majors", "a.txt")
        out = self.refusal()
        self.assertIn("A fix made after the last round needs a round of its own", out)
        self.assertIn("review-more", out)
        with open(os.path.join(ROOT, "templates", "assistant.md")) as f:
            guide = f.read()
        [line] = [x for x in guide.splitlines() if x.startswith("- A task out of review rounds")]
        self.assertIn("that fix needs a round of its own", line)
        self.assertIn("Never tell it to say ready without one", line)

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

    def test_out_of_rounds_after_fixing_a_conflict_needs_you_at_once(self):
        """#1040: a conflict its agent fixed by merging the base, then ready refused for rounds: its fresh status
        line kept it Working on the conflict, and only the 20-minute stall reached the Assistant."""
        from herdr_task import agents, base
        t = base.now()
        self.task.update(started=t - 3600000, agents=[{"address": "t1", "at": t - 3600000}],
                         attention="Conflicts with main", attention_at=t - 600000,
                         progress={"text": "Merging main in", "set": t - 300000, "at": t - 300000})
        live = [{"address": "t1", "status": {"state": "idle"}, "status_ms": t - 5000}]
        self.patch(agents, "agent_log", lambda *a, **k: None)
        self.assertEqual(agents.task_status(self.task, live)[0], "working")  # on the conflict
        self.task["review_out"] = t - 5000
        self.assertEqual(agents.task_status(self.task, live), ("needs", "reply", "Out of review rounds"))
        # still at it (its turn not ended yet): Working
        self.assertEqual(agents.task_status(self.task, [{**live[0], "status": {"state": "working"}}])[0], "working")

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

    def test_the_pull_request_title_and_body_are_short(self):
        """SHEP-198 (GitHub #924), SHEP-322: the title is the task's title (no task number), and the
        body is the summary, details and proof's title, never the brief."""
        import herdr_task.github as github
        wt, remote = self.task["worktree"], os.path.join(self.root, "remote.git")
        self.git(self.root, "init", "-q", "--bare", remote)
        self.git(self.main, "remote", "add", "origin", remote)
        self.commit(wt, "work", "a.txt")
        ref = self.store.ref(self.task)
        self.task.update({"title": "Flow", "prompt": "BRIEF-ONLY-LINE do the whole thing", "details": "- Checked the flow",
                          "proof": {"id": "a-1", "title": f"{ref}: Flow · Proof"}})
        asked = []

        def gh(*a, **k):
            asked.append(a)
            return (True, "https://github.com/o/r/pull/9", "") if a[:2] == ("pr", "create") else (True, "[]", "")
        self.patch(github, "gh", gh)
        self.assertEqual(github.pr_open(self.store, self.task, "o/r", "The flow works now")["number"], 9)
        create = next(a for a in asked if a[:2] == ("pr", "create"))
        title, body = create[create.index("--title") + 1], create[create.index("--body") + 1]
        # SHEP-322: the title alone, no task key in the title or the body
        self.assertEqual(title, "Flow")
        self.assertNotIn("BRIEF-ONLY-LINE", body)
        self.assertNotIn(ref, body)
        self.assertIn("The flow works now", body)
        self.assertIn("- Checked the flow", body)
        self.assertIn("Flow · Proof", body)
        self.assertLess(len(body), 400)
        # An older title that starts with its key keeps only the rest.
        self.assertEqual(github.pr_title(self.store, {**self.task, "title": f"{ref} Flow"}), "Flow")

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

    def test_ready_takes_its_pull_request_out_of_the_merge_queue_to_push(self):
        """#1215: GitHub locks a branch while its pull request sits in the merge queue (here: the remote refuses pushes
        while it is queued). Ready takes it out first, pushes, and it goes back in once its checks pass."""
        import herdr_task.github as github
        wt, remote = self.task["worktree"], os.path.join(self.root, "remote.git")
        self.git(self.root, "init", "-q", "--bare", remote)
        self.git(self.main, "remote", "add", "origin", remote)
        self.commit(wt, "work", "a.txt")
        self.git(wt, "push", "-q", "origin", "task/1")
        queued = os.path.join(self.root, "queued")
        open(queued, "w").close()
        with open(os.path.join(remote, "hooks", "pre-receive"), "w") as f:
            f.write(f"#!/bin/sh\nif [ -e '{queued}' ]; then echo 'protected branch hook declined' >&2; exit 1; fi\n")
        os.chmod(os.path.join(remote, "hooks", "pre-receive"), 0o755)
        asked = []

        def gh(*a, **k):
            asked.append(a)
            if a[:2] == ("api", "graphql"):
                q = next(x for x in a if x.startswith("query="))
                if "dequeuePullRequest" in q:
                    os.remove(queued)
                    return True, "{}", ""
                return True, json.dumps({"data": {"repository": {"pullRequest": {
                    "id": "PR_n7", "state": "OPEN", "mergeable": "CONFLICTING", "isInMergeQueue": os.path.exists(queued),
                    "autoMergeRequest": None, "timelineItems": {"nodes": []}}}}}), ""
            if a[:2] == ("pr", "view"):
                return True, "OPEN", ""
            return True, "[]", ""
        self.patch(github, "gh", gh)
        self.task.update(pr={"number": 7, "url": "u7", "repo": "o/r"}, merge_queued=1, state="ready")
        tip = self.commit(wt, "merge main in", "a.txt")
        self.assertEqual(github.pr_open(self.store, self.task, "o/r")["number"], 7)
        self.assertEqual(self.git(self.root, "--git-dir", remote, "rev-parse", "task/1"), tip)
        dequeue = [a for a in asked if any("dequeuePullRequest" in x for x in a)]
        self.assertEqual([x for x in dequeue[0] if x.startswith("id=")], ["id=PR_n7"])
        self.assertNotIn("merge_queued", self.task)  # out of the queue: not "removed" news for the tick
        # Ready then: back in the queue once its checks pass (merge after checks), whatever the merge setting.
        self.patch(self.commands, "github", lambda s: "o/r")
        self.patch(self.commands, "pr_open", lambda s, t, repo, summary=None: t["pr"])
        self.patch(self.commands, "merge_policy", lambda s, t: "ask")
        msg = self.commands.finalize(self.store, self.task)
        self.assertEqual(self.task.get("auto_merge"), "checks")
        self.assertIn("goes back in once its checks pass", msg)
        self.assertNotIn("dequeued", self.task)
        # A later ready (out of the queue now) is the merge setting's again.
        self.task.pop("auto_merge")
        self.commands.finalize(self.store, self.task)
        self.assertNotIn("auto_merge", self.task)

    def test_a_queue_that_refuses_to_let_go_is_said(self):
        """#1215: GitHub refusing the dequeue: ready says why it couldn't push, nothing pushed."""
        import herdr_task.github as github
        wt, remote = self.task["worktree"], os.path.join(self.root, "remote.git")
        self.git(self.root, "init", "-q", "--bare", remote)
        self.git(self.main, "remote", "add", "origin", remote)
        self.commit(wt, "work", "a.txt")

        def gh(*a, **k):
            q = next((x for x in a if x.startswith("query=")), "")
            if "dequeuePullRequest" in q:
                return False, "", "Resource not accessible by integration"
            return True, json.dumps({"data": {"repository": {"pullRequest": {
                "id": "PR_n7", "state": "OPEN", "isInMergeQueue": True, "timelineItems": {"nodes": []}}}}}), ""
        self.patch(github, "gh", gh)
        self.task["pr"] = {"number": 7, "url": "u7", "repo": "o/r"}
        with self.assertRaises(Exception) as e:
            github.pr_push(self.store, self.task, "o/r")
        self.assertIn("out of GitHub's merge queue", str(e.exception))
        self.assertIn("Resource not accessible", str(e.exception))
        self.assertEqual(self.git(self.root, "--git-dir", remote, "branch", "--list", "task/1"), "")

    def taking(self, prs):
        """A GitHub remote (a bare repo) and gh answering `pr view` from prs ({number: fields}); what gh was asked."""
        import herdr_task.github as github
        remote = os.path.join(self.root, "remote.git")
        self.git(self.root, "init", "-q", "--bare", remote)
        self.git(self.main, "remote", "add", "origin", remote)
        self.git(self.main, "push", "-q", "origin", "main")
        asked = []

        def gh(*a, **k):
            asked.append(a)
            if a[:2] == ("pr", "view"):
                v = prs.get(int(a[2]))
                if not v:
                    return False, "", "no pull requests found"
                return True, (v["state"] if "-q" in a else json.dumps({"number": int(a[2]), "url": f"https://github.com/o/r/pull/{a[2]}",
                                                                       "isCrossRepository": False, "baseRefName": "main", **v})), ""
            return (True, "https://github.com/o/r/pull/99", "") if a[:2] == ("pr", "create") else (True, "[]", "")
        self.patch(github, "gh", gh)
        self.patch(self.commands, "gh", gh)
        self.patch(self.commands, "github", lambda s: "o/r")
        return remote, asked

    def test_ready_takes_a_pull_request_on_another_branch(self):
        """#1155: its agent pushed to fix/thing and opened a pull request there, then closed the one on the task branch.
        ready --pr takes the open one: no second pull request, and later commits go to its branch."""
        import herdr_task.github as github
        wt = self.task["worktree"]
        tip = self.commit(wt, "the fix", "a.txt")
        remote, asked = self.taking({31: {"state": "OPEN", "headRefName": "fix/thing", "headRefOid": tip}, 30: {"state": "CLOSED"}})
        self.git(wt, "push", "-q", "origin", "task/1:refs/heads/fix/thing")
        self.task["pr"] = {"number": 30, "url": "https://github.com/o/r/pull/30", "repo": "o/r"}  # the closed one
        self.commands.take_pr(self.store, self.task, "#31")
        self.assertEqual(self.task["pr"], {"number": 31, "url": "https://github.com/o/r/pull/31", "repo": "o/r", "taken": True,
                                           "branch": "fix/thing"})
        self.assertEqual(github.pr_open(self.store, self.task, "o/r", "Fixed")["number"], 31)
        self.assertNotIn(("pr", "create"), [a[:2] for a in asked])
        self.assertNotIn(("pr", "edit"), [a[:2] for a in asked])  # its description is its author's
        self.assertEqual(self.git(self.root, "--git-dir", remote, "branch", "--list", "task/1"), "")
        tip = self.commit(wt, "a later fix", "a.txt")
        github.pr_open(self.store, self.task, "o/r")
        self.assertEqual(self.git(self.root, "--git-dir", remote, "rev-parse", "fix/thing"), tip)
        # Taken again: nothing changes. "" lets go of it.
        self.commands.take_pr(self.store, self.task, "31")
        self.assertEqual(self.task["pr"]["number"], 31)
        self.commands.take_pr(self.store, self.task, "")
        self.assertNotIn("pr", self.task)

    def test_a_pull_request_that_cant_be_taken_is_refused(self):
        """--pr: closed, from a fork, merging elsewhere, another task's, or ahead of the task's branch: refused, nothing kept."""
        wt = self.task["worktree"]
        tip = self.commit(wt, "work", "a.txt")
        remote, _ = self.taking({1: {"state": "CLOSED", "headRefName": "x"}, 2: {"state": "OPEN", "headRefName": "x", "isCrossRepository": True},
                                 3: {"state": "OPEN", "headRefName": "x", "baseRefName": "dev", "headRefOid": tip},
                                 4: {"state": "OPEN", "headRefName": "ahead", "headRefOid": "0" * 40}})
        self.git(wt, "push", "-q", "origin", "task/1:refs/heads/ahead")
        other = self.commit(wt, "theirs only", "b.txt")
        self.git(wt, "push", "-q", "-f", "origin", "task/1:refs/heads/ahead")
        self.git(wt, "reset", "-q", "--hard", "HEAD~1")
        for n, said in ((1, "is closed"), (2, "from a fork"), (3, "merges into dev"), (77, "Couldn't find"), ("x", "number")):
            with self.assertRaises(Exception) as e:
                self.commands.take_pr(self.store, self.task, str(n))
            self.assertIn(said, str(e.exception))
        import herdr_task.github as github
        prs = {4: {"state": "OPEN", "headRefName": "ahead", "headRefOid": other}}
        self.patch(self.commands, "gh", lambda *a, **k: (True, json.dumps({"number": 4, "url": "u", "baseRefName": "main", **prs[4]}), ""))
        with self.assertRaises(Exception) as e:
            self.commands.take_pr(self.store, self.task, "4")
        self.assertIn("doesn't hold pull request #4's latest commit", str(e.exception))
        self.assertNotIn("pr", self.task)
        self.store.data["tasks"].append({"id": 2, "title": "Other", "state": "ready", "pr": {"number": 4, "repo": "o/r"}})
        self.git(wt, "merge", "-q", "--ff-only", other)
        with self.assertRaises(Exception) as e:
            self.commands.take_pr(self.store, self.task, "4")
        self.assertIn("already", str(e.exception))

    def test_a_new_task_works_on_the_pull_request_it_took(self):
        """#1195 idea 6: add --pr <a bot's pull request>: its worktree starts on that branch, the bot's commits are its work
        (nothing-to-merge never), its brief says so, and ready pushes on top of the bot's branch."""
        import herdr_task.github as github
        import herdr_task.launch as launch
        prs = {}
        remote, asked = self.taking(prs)
        bot = os.path.join(self.root, "bot")
        self.git(self.root, "clone", "-q", "-b", "main", remote, bot)
        for k, v in (("user.name", "B"), ("user.email", "b@example.com"), ("commit.gpgsign", "false")):
            self.git(bot, "config", k, v)
        self.git(bot, "checkout", "-q", "-b", "deps/bump-x")
        bump = self.commit(bot, "bump x", "deps.txt")
        self.git(bot, "push", "-q", "origin", "deps/bump-x")
        self.store.data["tasks"].append({"id": 2, "title": "Land the bump", "state": "todo", "mode": "worktree", "agents": []})
        t = self.store.data["tasks"][-1]
        prs[12] = {"state": "OPEN", "headRefName": "deps/bump-x", "headRefOid": bump}
        self.patch(launch, "WORKTREES", os.path.join(self.root, "trees"))
        self.patch(launch, "settings_for", lambda s, space: {"tasks": {}})
        self.commands.take_pr(self.store, t, "12")
        self.assertEqual(t["pr"]["branch"], "deps/bump-x")
        wt = launch.folder_for(self.store, t)
        self.assertEqual(self.git(wt, "rev-parse", "HEAD"), bump)
        self.assertEqual(t["start"], self.git(self.main, "rev-parse", "main"))
        self.assertFalse(self.commands.in_base(self.store, t))
        self.assertIn("took pull request #12 (branch deps/bump-x)", launch.where_line(t))
        mine = self.commit(wt, "fix the build after the bump", "a.txt")
        self.assertEqual(github.pr_open(self.store, t, "o/r", "The bump lands")["number"], 12)
        self.assertEqual(self.git(self.root, "--git-dir", remote, "rev-parse", "deps/bump-x"), mine)
        self.assertNotIn(("pr", "create"), [a[:2] for a in asked])

    def test_a_taken_pull_request_that_closed_is_said(self):
        """A taken pull request closed meanwhile: ready says so, never a new pull request of the task's own instead."""
        import herdr_task.github as github
        wt = self.task["worktree"]
        tip = self.commit(wt, "work", "a.txt")
        remote, asked = self.taking({5: {"state": "CLOSED"}})
        self.git(wt, "push", "-q", "origin", "task/1:refs/heads/theirs")
        self.task["pr"] = {"number": 5, "url": "u", "repo": "o/r", "taken": True, "branch": "theirs"}
        with self.assertRaises(Exception) as e:
            github.pr_open(self.store, self.task, "o/r")
        self.assertIn("which this task took, is closed", str(e.exception))
        self.assertNotIn(("pr", "create"), [a[:2] for a in asked])

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
        a = {"id": 1, "title": "Sweep", "prompt": "Read the open pull requests", "space": "sp1"}
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

    def test_low_priority_never_clamps_qos(self):
        """#1109: on a Mac a worker runs under nice alone, never taskpolicy's utility clamp (keys echoed 20-100x slower)."""
        from herdr_task import launch
        bin_ = os.path.join(self.root, "qosbin")
        os.makedirs(bin_, exist_ok=True)
        mark = os.path.join(self.root, "taskpolicy-ran")
        with open(os.path.join(bin_, "taskpolicy"), "w") as f:
            f.write('#!/bin/sh\ntouch %s\nshift 2\nexec "$@"\n' % mark)
        os.chmod(os.path.join(bin_, "taskpolicy"), 0o755)
        low = launch.LOW.replace("/proc/self/oom_score_adj", os.path.join(self.root, "none", "oom_score_adj"))
        p = subprocess.run(["sh", "-c", low, "herdr-low", "sh", "-c", "echo ran"], capture_output=True, text=True,
                           env={**os.environ, "PATH": bin_ + os.pathsep + os.environ["PATH"]})
        self.assertEqual(p.stdout.strip(), "ran")
        self.assertFalse(os.path.exists(mark))
        self.assertNotIn("taskpolicy", launch.LOW)

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
    """SHEP-185, 3.2: a machine's reach map lists its spaces from herdr-core's shared document in Shepherdr's own session
    there (never a window's list: a herdr-app on PATH is not asked); the probe runs for real with a fake hc on PATH."""

    def probe(self, live=None, saved=None, other=None):
        sys.path.insert(0, BIN)
        from herdr_task.machines import PROBE
        root = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(root, ignore_errors=True))
        bin_ = os.path.join(root, "bin")
        os.makedirs(bin_)
        for session, spaces in (("shepherdr", saved or []), ("default", other or [])):
            state = os.path.join(root, "state", "herdr-core", session)
            os.makedirs(state)
            with open(os.path.join(state, "docs.json"), "w") as f:
                json.dump({"herdr-app": {"value": {"spaces": spaces}, "version": 3}}, f)
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
        env = {**{k: v for k, v in os.environ.items() if k != "HC_SESSION"}, "PATH": bin_, "XDG_STATE_HOME": os.path.join(root, "state")}
        out = subprocess.run([sys.executable, "-c", "import sys; S = sys.stdin.read(); exec(S)", json.dumps({"depth": 0, "seen": [], "timeout": 20})],
                             input=PROBE, capture_output=True, text=True, env=env, timeout=120)
        return json.loads(out.stdout.strip().splitlines()[-1])

    def test_the_sessions_document_is_read(self):
        got = self.probe(saved=[{"id": "sp2", "name": "shop", "folder": "/base/shop"}, {"id": "vm/sp9", "name": "far", "machine": "vm"}],
                         other=[{"id": "sp7", "name": "the Herdr app's", "folder": "/base/x"}])
        self.assertEqual([(s["id"], s["name"]) for s in got["spaces"]], [("sp2", "shop")])  # its own, never the default session's
        self.assertEqual(got["home"], os.path.expanduser("~"))

    def test_a_window_is_never_asked(self):
        got = self.probe(live=[{"id": "sp1", "name": "", "folder": os.path.expanduser('~')}], saved=[{"id": "sp3", "name": "lab", "folder": "/base/x"}])
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


class ExpectedChecks(unittest.TestCase):
    """#1044: whether checks will come for a pull request, read from its repo's workflows at its head
    (a real throwaway git repo)."""

    def setUp(self):
        import shutil
        sys.path.insert(0, BIN)
        import herdr_task.github as github
        self.github = github
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.git = lambda *a: subprocess.run(["git", "-C", self.dir, "-c", "user.name=T", "-c", "user.email=t@example.com", *a],
                                             check=True, capture_output=True, text=True).stdout.strip()
        self.git("init", "-q", "-b", "main")
        self.git("commit", "-q", "--allow-empty", "-m", "base")

    def commit(self, files):
        for name, text in files.items():
            path = os.path.join(self.dir, ".github", "workflows", name)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w") as f:
                f.write(text)
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "workflows")
        return self.git("rev-parse", "HEAD")

    def expect(self, sha, task=None):
        s = Store([])
        s.loc = {"folder": self.dir, "kind": "repo", "name": "app"}
        return self.github.expected_checks(s, task or {"pr": {}, "base": "main", "branch": "main"}, sha)

    def test_triggers(self):
        w = self.github.workflow_checks
        with open(os.path.join(ROOT, ".github", "workflows", "check.yml")) as f:
            self.assertEqual(w(f.read()), "yes")
        for text, want in (("on: pull_request", "yes"), ("on: [push, pull_request]", "yes"), ("on:\n  - push\n  - pull_request\n", "yes"),
                           ("on:\n  pull_request:\n    branches: [ main ]\n", "yes"),
                           ("on:\n  pull_request:\n    types: [opened, synchronize]\njobs:\n  a:\n    runs-on: x\n", "yes"),
                           ("'on':\n  pull_request_target:\n", "yes"),
                           ("on:\n  pull_request:\n    branches:\n      - develop\n", "maybe"),
                           ("on:\n  pull_request:\n    paths: ['src/**']\n", "maybe"),
                           ("on:\n  push:\n    branches: [main]\n  pull_request:\n    paths-ignore: [docs/**]\n", "maybe"),
                           ("on: [push]", "maybe"), ("on:\n  workflow_dispatch:\n  # pull_request: off for now\n", None),
                           ("on:\n  schedule:\n    - cron: '0 3 * * *'\n", None)):
            self.assertEqual(w(text), want, text)

    def test_read_at_its_head_and_kept_per_commit(self):
        self.assertIsNone(self.expect(self.git("rev-parse", "HEAD")))
        sha = self.commit({"docs.yml": "on:\n  workflow_dispatch:\n", "ci.yaml": "on:\n  pull_request:\n    branches: [main]\n"})
        task = {"pr": {"number": 1}, "base": "main", "branch": "main"}
        self.assertEqual(self.expect(sha, task), "yes")
        self.assertEqual(task["pr"]["expects"], {"sha": sha, "is": "yes"})
        # a commit not here yet (pushed elsewhere): its branch's workflows stand in
        self.assertEqual(self.expect("0" * 40), "yes")


class DoubleStart(unittest.TestCase):
    """#1053: a queued task started by the tick, then by an explicit start (or a message) a moment
    later, while its new agent still shows its shell: one agent, never two. Scheduled's real store."""
    run_cmd, add, tick_at, task = Scheduled.run_cmd, Scheduled.add, Scheduled.tick_at, Scheduled.task

    def setUp(self):
        Scheduled.setUp(self)
        import time
        from unittest import mock

        def begin(s, t, argv, space, parent=None):
            t["state"], t["started"] = "running", 1
            for k in ("queue", "queued_at", "held", "scheduled_for"):
                t.pop(k, None)
            t.setdefault("agents", []).append({"address": f"t{len(self.started) + 44}", "agent": "claude", "at": int(time.time() * 1000)})
            s.dirty = True
            self.started.append(s.ref(t))
            return t["agents"][-1]
        for mod in (self.commands, self.tick):
            p = mock.patch.object(mod, "begin", begin)
            p.start()
            self.addCleanup(p.stop)

    def test_start_right_after_the_queue_started_it(self):
        self.add("First")
        self.add("Second", after="1")
        self.run_cmd(self.commands.cmd_start, id="2")
        self.assertEqual(self.task(2)["state"], "queued")
        with self.store_mod.Store(self.store_mod.locate(self.folder)) as s:
            s.find(1)["state"] = "done"  # its dependency cleared
            s.dirty = True
        self.assertEqual(self.tick_at(int(__import__("time").time() * 1000)), ["APP-2"])
        with self.assertRaises(self.Fail) as e:
            self.run_cmd(self.commands.cmd_start, id="2")
        self.assertIn("already running (t44)", str(e.exception))
        with self.assertRaises(self.Fail):
            self.run_cmd(self.commands.cmd_resume, id="2")
        with self.store_mod.Store(self.store_mod.locate(self.folder)) as s:
            with self.assertRaises(self.Fail):
                self.commands.tell(s, s.find(2), "a note", None)
        self.assertEqual((self.started, len(self.task(2)["agents"])), (["APP-2"], 1))

    def test_an_agent_gone_long_after_can_start_again(self):
        self.add("Only")
        self.run_cmd(self.commands.cmd_start, id="1", now=True)
        with self.store_mod.Store(self.store_mod.locate(self.folder)) as s:
            s.find(1)["agents"][-1]["at"] -= self.commands.STARTING_MS + 1000
            s.dirty = True
        self.run_cmd(self.commands.cmd_start, id="1", now=True)
        self.assertEqual(len(self.task(1)["agents"]), 2)

    def test_reads_never_wait_for_a_busy_list_and_a_status_gives_up(self):
        """#1130: the scheduler (or any slow command) holding the list's lock kept show, list and status waiting for
        minutes. Reads go on at once (saves replace the list whole); a status gives up after a short wait, saying so."""
        import fcntl
        import time
        from unittest import mock
        self.add("Busy")
        with self.store_mod.Store(self.store_mod.locate(self.folder), write=False) as s:
            lock = os.path.join(self.store_mod.STORE, "." + os.path.basename(s.path) + ".lock")
        held = open(lock, "a")
        self.addCleanup(held.close)
        fcntl.flock(held, fcntl.LOCK_EX)
        t = time.time()
        self.assertEqual(self.task(1)["title"], "Busy")
        shown = self.run_cmd(self.commands.cmd_show, id="1")
        self.assertEqual(shown["title"], "Busy")
        listed = self.run_cmd(self.commands.cmd_list, all=False, archived=False)
        self.assertIn("Busy", json.dumps(listed))
        self.assertLess(time.time() - t, 5)
        with mock.patch.object(self.commands, "STATUS_WAIT", 0.5), self.assertRaises(self.Fail) as e:
            self.run_cmd(self.commands.cmd_status, id="1", text="Working", done=None, left=None)
        self.assertIn("is busy", str(e.exception))
        self.assertIn("nothing was changed", str(e.exception))
        fcntl.flock(held, fcntl.LOCK_UN)
        # free again: a read that learns something saves it, as before
        with self.store_mod.Store(self.store_mod.locate(self.folder), write="try") as s:
            self.assertTrue(s.write)

    def test_a_here_start_in_another_worktree_is_refused(self):
        """#1210: start --here --folder <a worktree of the repo> ran in the repo's own folder, on another branch. It
        says so and starts nothing; the repo's own folder (or a folder in it) still starts --here."""
        wt = os.path.join(self.tmp, "app-wt")
        subprocess.run(["git", "-C", self.folder, "worktree", "add", "-q", "-b", "feat", wt], check=True)
        self.add("Go on there", folder=wt)
        with self.assertRaises(self.Fail) as e:
            self.run_cmd(self.commands.cmd_start, id="1", here=True, folder=wt, now=True)
        self.assertIn(f"{os.path.realpath(wt)} is another worktree of", str(e.exception))
        self.assertIn("without --here", str(e.exception))
        self.assertEqual((self.started, self.task(1)["state"]), ([], "todo"))
        os.makedirs(os.path.join(self.folder, "web"))
        self.run_cmd(self.commands.cmd_start, id="1", here=True, folder=os.path.join(self.folder, "web"), now=True)
        self.assertEqual(self.started, ["APP-1"])


class ReadyMergeGit(unittest.TestCase):
    """SHEP-231: ready, merge and git fixes (#1007, #1004, #988, #989, #1041, #1052, #1023), in TaskFlow's
    throwaway repo and store; hc and gh are never run."""
    setUp, patch, git, commit, args = TaskFlow.setUp, TaskFlow.patch, TaskFlow.git, TaskFlow.commit, TaskFlow.args

    def patch_new(self, mod, name, value):
        """A name the fix adds (create: so the same test runs against the code before it)."""
        p = self.mock.patch.object(mod, name, value, create=True)
        p.start()
        self.addCleanup(p.stop)

    def remote(self):
        remote = os.path.join(self.root, "remote.git")
        self.git(self.root, "init", "-q", "--bare", remote)
        self.git(self.main, "remote", "add", "origin", remote)
        return remote

    def test_ready_pushes_without_holding_the_task_list(self):
        """#1007: while ready's push runs the repo's pre-push hook, the task list's lock is free, and what another
        command saved meanwhile (a status line) is kept."""
        import herdr_task.github as github
        import herdr_task.store as store
        tasks = os.path.join(self.root, "tasks")
        self.patch(store, "STORE", tasks)
        self.remote()
        self.commit(self.task["worktree"], "work", "a.txt")
        seen = os.path.join(self.root, "seen")
        hook = os.path.join(self.root, "hook.py")
        with open(hook, "w") as f:
            f.write("import fcntl, glob, json, os, sys\n"
                    "tasks, seen = sys.argv[1], sys.argv[2]\n"
                    "lock = open(glob.glob(os.path.join(tasks, '.*.lock'))[0], 'a')\n"
                    "try:\n"
                    "    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)\n"
                    "except OSError:\n"
                    "    open(seen, 'w').write('held')\n"
                    "    sys.exit(0)\n"
                    "p = [x for x in glob.glob(os.path.join(tasks, '*.json'))][0]\n"
                    "d = json.load(open(p))\n"
                    "d['tasks'][0]['progress'] = {'text': 'said by another command'}\n"
                    "json.dump(d, open(p, 'w'))\n"
                    "open(seen, 'w').write('free')\n")
        hooks = os.path.join(self.main, ".git", "hooks")
        os.makedirs(hooks, exist_ok=True)
        with open(os.path.join(hooks, "pre-push"), "w") as f:
            f.write(f"#!/bin/sh\n{sys.executable} {hook} {tasks} {seen}\nexit 0\n")
        os.chmod(os.path.join(hooks, "pre-push"), 0o755)
        self.patch(github, "gh", lambda *a, **k: (True, "https://github.com/o/r/pull/7", "") if a[:2] == ("pr", "create") else (True, "[]", ""))
        loc = {"folder": self.main, "kind": "repo", "name": "repo", "common": os.path.join(self.main, ".git")}
        with store.Store(loc) as s:
            s.data["tasks"] = [dict(self.task, id=1)]
            s.data["next"] = 2
            s.dirty = True
        with store.Store(loc) as s:
            t = s.find("1")
            self.assertEqual(github.pr_open(s, t, "o/r")["number"], 7)
        with open(seen) as f:
            self.assertEqual(f.read(), "free")
        with store.Store(loc, write=False) as s:
            t = s.find("1")
            self.assertEqual((t["pr"]["number"], t["progress"]["text"]), (7, "said by another command"))

    def test_a_second_ready_updates_the_pull_request_description(self):
        """#1004: the open pull request Herdr opened gets this ready's details; one a person wrote is left alone."""
        import herdr_task.github as github
        self.remote()
        self.commit(self.task["worktree"], "work", "a.txt")
        self.task.update(pr={"number": 7, "url": "u", "repo": "o/r"}, details="- The second round's fix")
        body = ["Task: SHEP-1\n\n## Details\n\n- The first round"]
        asked = []

        def gh(*a, **k):
            asked.append(a)
            if a[:2] == ("pr", "view") and "body" in a:
                return True, body[0], ""
            return (True, "OPEN", "") if a[:2] == ("pr", "view") else (True, "[]", "")
        self.patch(github, "gh", gh)
        github.pr_open(self.store, self.task, "o/r", "Fixed after review")
        edit = [a for a in asked if a[:2] == ("pr", "edit")]
        self.assertEqual(len(edit), 1)
        self.assertIn("- The second round's fix", edit[0][edit[0].index("--body") + 1])
        self.assertIn("Fixed after review", edit[0][edit[0].index("--body") + 1])
        asked.clear()
        body[0] = "My own words on this change"
        github.pr_open(self.store, self.task, "o/r", "Fixed after review")
        self.assertEqual([a for a in asked if a[:2] == ("pr", "edit")], [])

    def own_commit(self):
        from herdr_task import github
        self.patch(github, "live_agents", lambda key: [])
        self.patch(github, "live_helpers", lambda key: [])
        tip = self.commit(self.task["worktree"], "work", "a.txt")
        self.task.update(state="ready", head=tip)
        github.own_work(self.store, self.task)  # as ready records it
        return tip

    def test_accept_merges_the_open_pull_request_not_here(self):
        """#988: no pull request on record, its agent opened one: Accept merges that one on GitHub, the base here untouched."""
        import herdr_task.github as github
        tip = self.own_commit()
        base = self.git(self.main, "rev-parse", "main")
        self.patch(self.commands, "github", lambda s: "o/r")
        self.patch(github, "gh", lambda *a, **k: (True, json.dumps([{"number": 12, "url": "https://github.com/o/r/pull/12",
                                                                        "isCrossRepository": False, "baseRefName": "main",
                                                                        "headRefOid": tip}]), "") if a[:2] == ("pr", "list") else (True, "", ""))
        merged = []
        self.patch(self.commands, "merge_now", lambda s, t, **k: merged.append(t["pr"]["number"]))
        self.commands.cmd_accept(self.args())
        self.assertEqual(merged, [12])
        self.assertEqual(self.git(self.main, "rev-parse", "main"), base)

    def test_accept_never_merges_here_when_github_cant_be_asked(self):
        """#988: a repo on GitHub that gh couldn't reach just now: nothing merged here; a pull request behind the tip: refused too."""
        import herdr_task.github as github
        self.own_commit()
        base = self.git(self.main, "rev-parse", "main")
        self.patch(self.commands, "github", lambda s: None)
        self.patch_new(self.commands, "github_unreachable", lambda s: "HTTP 502")
        with self.assertRaises(self.commands.Fail) as e:
            self.commands.cmd_accept(self.args())
        self.assertIn("HTTP 502", str(e.exception))
        self.patch(self.commands, "github", lambda s: "o/r")
        self.patch(github, "gh", lambda *a, **k: (True, json.dumps([{"number": 12, "url": "u", "isCrossRepository": False,
                                                                        "baseRefName": "main", "headRefOid": "0" * 40}]), ""))
        with self.assertRaises(self.commands.Fail) as e:
            self.commands.cmd_accept(self.args())
        self.assertIn("#12", str(e.exception))
        self.assertEqual(self.git(self.main, "rev-parse", "main"), base)
        self.assertNotIn("pr", self.task)

    def test_github_down_is_not_remembered_as_no_github(self):
        """#988: gh failing on a repo whose remote is on GitHub isn't kept for an hour as "merge locally"."""
        import herdr_task.github as github
        self.git(self.main, "remote", "add", "origin", "git@github.com:o/r.git")
        self.store.data = {"tasks": [self.task]}
        self.store.loc["kind"] = "repo"
        self.patch(github.shutil, "which", lambda x: "/usr/bin/gh")
        self.patch(github, "gh", lambda *a, **k: (False, "", "error connecting to api.github.com"))
        self.assertIsNone(github.github(self.store))
        self.assertNotIn("github", self.store.data)
        self.assertIn("api.github.com", github.github_unreachable(self.store))
        # ready then says it couldn't open its pull request, never Ready as if merged here.
        self.store.data["tasks"] = [self.task]
        self.patch(self.commands, "github", github.github)
        self.patch(self.commands, "merge_policy", lambda s, t: "ask")
        msg = self.commands.finalize(self.store, self.task)
        self.assertIn("Couldn't reach GitHub", msg)
        self.assertIn("Couldn't reach GitHub", self.task["attention"])
        # gh never signed in here: no GitHub for tasks (they merge locally), as before.
        self.patch(github, "gh", lambda *a, **k: (False, "", "To get started with GitHub CLI, please run:  gh auth login"))
        self.assertIsNone(github.github(self.store))
        self.assertEqual(self.store.data["github"]["repo"], None)

    def test_a_reopened_task_merged_here_stays_open(self):
        """#989: reopened after its work merged here: the tick doesn't mark it done again under its fix."""
        from herdr_task import tick
        self.own_commit()
        self.git(self.main, "merge", "-q", "--ff-only", "task/1")
        self.task["state"] = "done"
        self.task["merged"] = True
        self.patch(self.commands, "unarchive", lambda *a: None)
        self.commands.cmd_state(self.args(), "reopen")
        self.assertEqual(self.task["state"], "running")
        self.patch(tick, "live_agents", lambda key: [])
        done = []
        self.patch(tick, "finish", lambda s, t, *a, **k: done.append(t["id"]))
        tick.facts(self.store, self.task, {"done": [], "attention": []})
        self.assertEqual(done, [])
        self.task.pop("kept_open")  # as before #989: done at once
        tick.facts(self.store, self.task, {"done": [], "attention": []})
        self.assertEqual(done, [1])

    def test_a_merge_queue_timeout_is_queued_again_once(self):
        """#1041: removed from the merge queue for checks_timed_out: queued again once by itself; a second time at
        the same commit needs the person; queued again by hand, its attention goes."""
        from herdr_task import tick, base
        self.task.update(state="ready", pr={"number": 7, "url": "u", "repo": "o/r"}, merge_queued=base.now() - 10 * 60000)
        q = {"in": False, "auto": False, "reason": "CHECKS_TIMED_OUT", "state": "OPEN"}
        self.patch(tick, "queue_entry", lambda t: dict(q))
        merged = []
        self.patch_new(tick, "queue_merge", lambda t, head: (merged.append(head), (True, ""))[1])
        v = {"state": "OPEN", "headRefOid": "abc", "mergeable": "MERGEABLE", "statusCheckRollup": []}
        report = {"attention": []}
        tick.queue_pass(self.store, self.task, v, report)
        self.assertEqual((merged, self.task.get("attention"), bool(self.task.get("merge_queued"))), (["abc"], None, True))
        self.task["merge_queued"] = base.now() - 10 * 60000
        tick.queue_pass(self.store, self.task, v, report)
        self.assertEqual(merged, ["abc"])
        self.assertEqual(self.task["attention"], "GitHub's merge queue removed it: CHECKS_TIMED_OUT.")
        q["in"] = True  # the person queued it again
        tick.back_in_queue(self.store, self.task, report)
        self.assertNotIn("attention", self.task)
        self.assertTrue(self.task.get("merge_queued"))
        # A failed check there is never queued again.
        self.task.update(merge_queued=base.now() - 10 * 60000, requeued=None)
        q.update({"in": False, "reason": "FAILED_CHECKS"})
        tick.queue_pass(self.store, self.task, v, report)
        self.assertEqual(merged, ["abc"])
        self.assertTrue(self.task["attention"].endswith("FAILED_CHECKS."))

    def test_add_refuses_a_repo_set_to_bare_by_mistake(self):
        """#1052: core.bare = true in a checked-out repo: add says so instead of quietly working in the folder."""
        from herdr_task import store
        self.git(self.main, "config", "core.bare", "true")
        self.store.loc.update(folder=self.main, kind="folder")
        args = self.args(title="Next", prompt="x", prompt_file=None, here=False, worktree=False, space=None, base=None,
                         branch=None, after=None, at=None, **{"in": None})
        self.patch(self.commands, "scheduled_at", lambda a: None)
        self.store.new = lambda title, prompt, mode: (_ for _ in ()).throw(AssertionError(f"added, in mode {mode!r}"))
        with self.assertRaises(self.commands.Fail) as e:
            self.commands.cmd_add(args)
        self.assertIn("core.bare", str(e.exception))
        self.assertEqual(len(self.store.data["tasks"]), 1)
        self.git(self.main, "config", "core.bare", "false")
        self.assertIsNone(store.bare_by_mistake(self.main))
        real = os.path.join(self.root, "real.git")
        self.git(self.root, "init", "-q", "--bare", real)
        self.assertIsNone(store.bare_by_mistake(real))  # a real bare repo isn't a mistake

    def test_a_start_reuses_its_registered_worktree(self):
        """#1023: the task lost its worktree fields while its worktree stayed, switched by its agent to another branch:
        it starts there again, on that branch, never "already exists"."""
        from herdr_task import launch
        wts = os.path.join(self.root, "worktrees")
        self.patch(launch, "settings_for", lambda s, space=None: {"tasks": {"worktree_root": wts}})
        path = os.path.join(wts, "repo", "task-flow")
        self.git(self.main, "worktree", "add", "-q", "-b", "task/flow-old", path, "main")
        self.commit(path, "work", "a.txt")
        self.git(path, "switch", "-q", "-c", "task/1-flow-reland")
        t = {"id": 1, "title": "Flow", "state": "running", "mode": "worktree", "agents": []}
        self.store.data["tasks"] = [t]
        self.assertEqual(launch.folder_for(self.store, t), path)
        self.assertEqual((t["worktree"], t["branch"], t["base"]), (path, "task/1-flow-reland", "main"))
        self.assertEqual(t["start"], self.git(self.main, "rev-parse", "main"))


    def test_a_like_named_branch_never_takes_another_tasks_worktree(self):
        """#1108: feature/a and feature-a make the same folder name: the second task gets its own worktree, never the
        first task's checkout."""
        from herdr_task import launch
        wts = os.path.join(self.root, "worktrees")
        self.patch(launch, "settings_for", lambda s, space=None: {"tasks": {"worktree_root": wts}})
        self.patch(launch, "fresh_start", lambda main, base: base)
        a = {"id": 1, "title": "A", "state": "running", "mode": "worktree", "agents": []}
        b = {"id": 2, "title": "B", "state": "running", "mode": "worktree", "agents": []}
        self.store.data["tasks"] = [a, b]
        names = {1: "feature/a", 2: "feature-a"}
        self.patch(launch, "branch_for", lambda s, t: names[t["id"]])
        first = launch.folder_for(self.store, a)
        second = launch.folder_for(self.store, b)
        self.assertNotEqual(first, second)
        self.assertEqual((a["branch"], b["branch"]), ("feature/a", "feature-a"))
        self.assertEqual(self.git(second, "rev-parse", "--abbrev-ref", "HEAD"), "feature-a")
        self.assertEqual(self.git(first, "rev-parse", "--abbrev-ref", "HEAD"), "feature/a")


class CodexGuardianRollout(unittest.TestCase):
    """GitHub #1201: a Codex process holds its approval reviewer's ("guardian") rollout open beside its own (and
    its spawned helpers'). The task's recorded session and the Assistant's saved resume record (herdr.resume) must
    name its own conversation, whichever file it opened first."""

    OWN, GUARDIAN, HELPER = ("00000000-0000-0000-0000-00000000000" + c for c in "cab")

    def setUp(self):
        sys.path.insert(0, BIN)
        import herdr_task.sessions as sessions
        import herdr_task.revive as revive
        self.sessions, self.revive = sessions, revive
        sessions._table["at"] = None
        self.addCleanup(lambda: sessions._table.update(at=None, children={}))
        d = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(d))

        def rollout(n, sid, source):
            f = os.path.join(d, f"rollout-2026-11-21T10-00-0{n}-{sid}.jsonl")
            with open(f, "w") as out:
                out.write(json.dumps({"timestamp": "2026-11-21T10:00:00.000Z", "type": "session_meta",
                                      "payload": {"id": sid, "cwd": "/w", "originator": "codex-tui", "source": source}}) + "\n")
            return f
        self.guardian = rollout(1, self.GUARDIAN, {"subagent": {"other": "guardian"}})
        self.helper = rollout(2, self.HELPER, {"subagent": {"thread_spawn": {"parent_thread_id": self.OWN, "depth": 1}}})
        self.own = rollout(3, self.OWN, "cli")

    def holding(self, files):
        code = "import sys,time\nfs=[open(p) for p in sys.argv[1:]]\nprint(1,flush=True)\ntime.sleep(30)"
        p = subprocess.Popen([sys.executable, "-c", code, *files], stdout=subprocess.PIPE)
        self.addCleanup(lambda: (p.kill(), p.wait(), p.stdout.close()))
        p.stdout.readline()
        return p.pid

    @unittest.skipUnless(os.path.isdir("/proc/self/fd"), "reads /proc")
    def test_session_is_its_own_never_the_guardians(self):
        for order in ([self.guardian, self.helper, self.own], [self.own, self.guardian], [self.helper, self.own]):
            self.assertEqual(self.sessions.session_of(self.holding(order)), (self.OWN, self.own), order)
        # its own not written yet: nothing, rather than the guardian
        self.assertEqual(self.sessions.session_of(self.holding([self.guardian, self.helper])), (None, None))

    def test_through_lsof_as_on_macos(self):
        from unittest import mock
        from types import SimpleNamespace
        out = "p4242\n" + "".join(f"f{i}\nn{f}\n" for i, f in enumerate([self.guardian, self.helper, self.own]))
        real_isdir = os.path.isdir
        with mock.patch.object(self.sessions.os.path, "isdir", lambda p: False if p.startswith("/proc") else real_isdir(p)), \
                mock.patch.object(self.sessions.shutil, "which", lambda n: "/usr/sbin/" + n), \
                mock.patch.object(self.sessions, "run", lambda args, **kw: SimpleNamespace(stdout=out if args[0] == "lsof" else "")):
            self.assertEqual(self.sessions.session_of(4242), (self.OWN, self.own))

    @unittest.skipUnless(os.path.isdir("/proc/self/fd"), "reads /proc")
    def test_the_assistants_resume_record_names_its_own_session(self):
        pid = self.holding([self.guardian, self.own])
        k = {"address": "t1", "pid": 1, "cwd": "/w", "argv": ["codex", "resume", self.OWN],
             "foreground": {"pid": pid, "argv": ["codex", "resume", self.OWN], "cwd": "/w"}}
        rec = self.revive.record_of(k)
        self.assertEqual((rec["session"], rec["log"]), (self.OWN, self.own))
        self.assertEqual(self.revive.resume_argv(rec["kind"], rec["argv"], rec["session"]), ["codex", "resume", self.OWN])

    def test_a_rollout_with_no_meta_yet_still_counts(self):
        empty = os.path.join(os.path.dirname(self.own), f"rollout-2026-11-21T10-00-04-{self.OWN}.jsonl")
        open(empty, "w").close()
        self.assertFalse(self.sessions.subagent_rollout(empty))
        self.assertFalse(self.sessions.subagent_rollout(self.own))
        self.assertTrue(self.sessions.subagent_rollout(self.guardian))
        self.assertTrue(self.sessions.subagent_rollout(self.helper))


class ClaudeConfigDir(unittest.TestCase):
    """GitHub #1120: an agent run with its own CLAUDE_CONFIG_DIR (a profile per folder, a dev container's /app/claude)
    keeps its session file and log there; herdr-task reads the folder from the process's environment (/proc, else
    ps -E on macOS) and finds them, never only ~/.claude."""
    SID = "11111111-2222-3333-4444-555555555555"

    def setUp(self):
        sys.path.insert(0, BIN)
        import herdr_task.sessions as sessions
        self.sessions = sessions
        sessions._table["at"] = None
        self.addCleanup(lambda: sessions._table.update(at=None, children={}))
        self.root = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(self.root))
        self.cfg = os.path.join(self.root, "app_claude")
        os.makedirs(os.path.join(self.cfg, "projects", "-w"))
        os.makedirs(os.path.join(self.cfg, "sessions"))
        self.log = os.path.join(self.cfg, "projects", "-w", self.SID + ".jsonl")
        open(self.log, "w").close()
        from unittest import mock
        p = mock.patch.object(sessions, "HOME", os.path.join(self.root, "home"))
        p.start()
        self.addCleanup(p.stop)

    def name_session(self, pid):
        with open(os.path.join(self.cfg, "sessions", f"{pid}.json"), "w") as f:
            json.dump({"pid": pid, "sessionId": self.SID}, f)

    @unittest.skipUnless(os.path.isfile("/proc/self/environ"), "reads /proc")
    def test_the_session_in_the_processs_own_config_dir(self):
        p = subprocess.Popen([sys.executable, "-c", "import time\nprint(1,flush=True)\ntime.sleep(30)"], stdout=subprocess.PIPE,
                             env={**os.environ, "CLAUDE_CONFIG_DIR": self.cfg})
        self.addCleanup(lambda: (p.kill(), p.wait(), p.stdout.close()))
        p.stdout.readline()
        self.name_session(p.pid)
        self.assertEqual(self.sessions.own_claude_dir(p.pid), self.cfg)
        self.assertEqual(self.sessions.session_of(p.pid), (self.SID, self.log))

    def test_through_ps_as_on_macos(self):
        from unittest import mock
        from types import SimpleNamespace
        self.name_session(4242)
        real_isdir = os.path.isdir
        seen = []

        def run(args, **kw):
            seen.append(args)
            return SimpleNamespace(stdout=f"claude --model x HOME=/x CLAUDE_CONFIG_DIR={self.cfg} TERM=y\n" if args[0] == "ps" else "")
        with mock.patch.object(self.sessions.os.path, "isdir", lambda p: False if p.startswith("/proc") else real_isdir(p)), \
                mock.patch.object(self.sessions.shutil, "which", lambda n: "/bin/" + n), \
                mock.patch.object(self.sessions, "run", run):
            self.assertEqual(self.sessions.session_of(4242), (self.SID, self.log))
        self.assertIn(["ps", "-wwE", "-o", "command=", "-p", "4242"], seen)

    def test_a_log_by_session_in_herdr_tasks_own_config_dir(self):
        from unittest import mock
        with mock.patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": self.cfg}):
            self.assertEqual(self.sessions.log_by_session("claude", self.SID), self.log)
        with mock.patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": ""}):
            self.assertIsNone(self.sessions.log_by_session("claude", self.SID))


class ProcessTable(unittest.TestCase):
    """GitHub #1013: finding an agent's session walked its process tree with a `pgrep -P` per process (each one
    reading every process), per agent, per task, from every tracker and list. One read of the process table now
    serves a pass: no process started on Linux, one `ps` on macOS."""

    def setUp(self):
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.sessions as sessions
        self.sessions, self.mock = sessions, mock
        sessions._table["at"] = None
        self.addCleanup(lambda: sessions._table.update(at=None, children={}))

    def test_a_real_tree_from_one_read(self):
        import signal
        tree = subprocess.Popen(["sh", "-c", "sh -c 'sleep 30 & wait' & sleep 30 & wait"], start_new_session=True)
        self.addCleanup(lambda: (os.killpg(tree.pid, signal.SIGKILL), tree.wait()))
        import time
        time.sleep(0.3)
        ran, reads = [], []
        real, real_run = self.sessions._read_table, self.sessions.run
        # #1108: logged, then run for real (macOS reads its table with ps: a stub returning None broke it there)
        with self.mock.patch.object(self.sessions, "run", lambda args, **kw: ran.append(args) or real_run(args, **kw)), \
                self.mock.patch.object(self.sessions, "_read_table", lambda: reads.append(1) or real()):
            under = self.sessions.kids(tree.pid)
            for _ in range(20):   # a pass's other agents and session lookups share the same read
                self.sessions.kids(tree.pid)
                self.sessions.session_of(tree.pid)
        self.assertEqual(len(under), 3, under)   # the inner sh and both sleeps
        if os.path.isdir("/proc/self"):
            self.assertEqual(ran, [])   # nothing started: no pgrep, no ps
        self.assertEqual(len(reads), 1)
        # the next pass (TABLE_FOR later) reads it again, so new processes show
        self.sessions._table["at"] -= self.sessions.TABLE_FOR + 1
        with self.mock.patch.object(self.sessions, "_read_table", lambda: reads.append(1) or real()):
            self.sessions.kids(tree.pid)
        self.assertEqual(len(reads), 2)

    def test_macos_reads_one_ps(self):
        from types import SimpleNamespace
        ps = "  1     0\n 13     1\n 10     1\n 11    10\n 12    11\n 99    98\n"
        ran = []
        real_isdir = os.path.isdir
        with self.mock.patch.object(self.sessions.os.path, "isdir", lambda p: False if p == "/proc/self" else real_isdir(p)), \
                self.mock.patch.object(self.sessions, "run", lambda args, **kw: ran.append(args) or SimpleNamespace(stdout=ps)):
            self.assertEqual(self.sessions.kids(10), ["11", "12"])
            # as the pgrep walk gave them: a child, all under it, then its next sibling by pid
            self.assertEqual(self.sessions.kids(1), ["10", "11", "12", "13"])
            self.assertEqual(self.sessions.kids(99), [])
        self.assertEqual(ran, [["ps", "-axo", "pid=,ppid="]])

    def test_a_name_with_brackets_and_spaces(self):
        """/proc/<pid>/stat's name can hold ") " itself: the parent is read after its last bracket."""
        with tempfile.TemporaryDirectory() as d:
            exe = os.path.join(d, "a) b (c")
            os.symlink("/bin/sleep", exe)
            p = subprocess.Popen([exe, "30"])
            self.addCleanup(lambda: (p.kill(), p.wait()))
            import time
            time.sleep(0.2)
            if not os.path.isdir("/proc/self"):
                self.skipTest("no /proc")
            self.assertIn(str(p.pid), self.sessions.kids(os.getpid()))
class CodexSandbox(unittest.TestCase):
    """SHEP-227 (#998, #1024): Codex's bwrap sandbox refused on this host (Ubuntu's AppArmor user-namespace limit) is
    found once, by a real `codex sandbox -- true` (here a fake codex), said with the fix for this host, never loosened."""

    def setUp(self):
        sys.dont_write_bytecode = True
        sys.path.insert(0, BIN)
        import herdr_task.sandbox as sandbox
        self.sandbox = sandbox
        self.dir = tempfile.mkdtemp()
        self.calls = os.path.join(self.dir, "calls")
        self.codex = os.path.join(self.dir, "codex")
        self.userns = os.path.join(self.dir, "userns")
        with open(self.userns, "w") as f:
            f.write("1\n")
        self.fake("echo 'bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted' >&2; exit 1")
        self.saved = {k: getattr(sandbox, k) for k in ("CACHE", "USERNS_SYSCTL", "APPARMOR_D")}
        sandbox.CACHE = os.path.join(self.dir, "state", "codex-sandbox.json")
        sandbox.USERNS_SYSCTL = self.userns
        sandbox.APPARMOR_D = os.path.join(self.dir, "apparmor.d")
        self.path = os.environ.get("PATH", "")
        os.environ["PATH"] = self.dir + os.pathsep + self.path

    def tearDown(self):
        for k, v in self.saved.items():
            setattr(self.sandbox, k, v)
        os.environ["PATH"] = self.path
        sys.path.remove(BIN)

    def fake(self, body):
        with open(self.codex, "w") as f:
            f.write(f"#!/bin/sh\necho \"$*\" >> {self.calls}\n{body}\n")
        os.chmod(self.codex, 0o755)

    def probes(self):
        try:
            with open(self.calls) as f:
                return f.read().splitlines()
        except OSError:
            return []

    def test_a_probe_that_did_not_answer_is_not_kept(self):
        """#1108: a probe that timed out (a busy machine) or couldn't start says nothing now and is asked again next
        time, never kept as "it starts" for a week."""
        self.fake("sleep 5")
        saved = self.sandbox.PROBE_TIMEOUT
        self.sandbox.PROBE_TIMEOUT = 0.2
        self.addCleanup(setattr, self.sandbox, "PROBE_TIMEOUT", saved)
        if os.uname().sysname != "Linux":
            self.skipTest("Linux only")
        self.assertIsNone(self.sandbox.check())
        self.assertFalse(os.path.exists(self.sandbox.CACHE))
        self.fake("echo 'bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted' >&2; exit 1")
        self.assertIn("RTM_NEWADDR", self.sandbox.check()["error"])
        self.assertEqual(len(self.probes()), 2)

    @unittest.skipUnless(sys.platform.startswith("linux"), "bwrap is Linux's")
    def test_found_once_and_said_with_the_fix(self):
        b = self.sandbox.check()
        self.assertEqual(b["error"], "bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted")
        self.assertTrue(b["userns"])
        self.assertEqual(self.probes(), ["sandbox -- true"])
        # asked once: kept until something it depends on changes
        self.assertEqual(self.sandbox.check(), b)
        self.assertEqual(len(self.probes()), 1)
        text = self.sandbox.notice(b)
        self.assertIn("AppArmor blocks it", text)
        self.assertIn("flags=(unconfined)", text)
        self.assertIn("apparmor_parser -r", text)
        self.assertIn("The sandbox stays on and nothing was changed", text)
        # the person adds the profile: asked again, and it starts now
        os.makedirs(self.sandbox.APPARMOR_D)
        with open(os.path.join(self.sandbox.APPARMOR_D, self.sandbox.PROFILE), "w") as f:
            f.write("profile x {}\n")
        self.fake("exit 0")
        self.assertIsNone(self.sandbox.check())
        self.assertEqual(len(self.probes()), 2)

    @unittest.skipUnless(sys.platform.startswith("linux"), "bwrap is Linux's")
    def test_without_apparmor_its_own_words(self):
        with open(self.userns, "w") as f:
            f.write("0\n")
        b = self.sandbox.check()
        self.assertFalse(b["userns"])
        self.assertNotIn("apparmor_parser", self.sandbox.notice(b))
        self.assertIn("user namespace", self.sandbox.notice(b))

    @unittest.skipUnless(sys.platform.startswith("linux"), "bwrap is Linux's")
    def test_other_failures_say_nothing(self):
        """Only bwrap's own refusal counts: an older Codex without `sandbox`, or a slow one, is no word."""
        self.fake("echo \"error: unrecognized subcommand 'sandbox'\" >&2; exit 2")
        self.assertIsNone(self.sandbox.check(fresh=True))

    def test_which_commands_run_in_the_sandbox(self):
        sb = self.sandbox.sandboxed
        self.assertTrue(sb(["codex", "--no-daemon", "-s", "workspace-write", "-a", "on-request"]))
        self.assertTrue(sb(["codex", "--no-daemon", "--sandbox", "read-only"]))
        self.assertFalse(sb(["codex", "--dangerously-bypass-approvals-and-sandbox"]))
        self.assertFalse(sb(["codex", "-s", "danger-full-access"]))
        self.assertFalse(sb(["claude", "--model", "opus"]))
        self.assertFalse(sb(None))


class DetachedActions(unittest.TestCase):
    """#1211: the window stops a command at 30 s, and an Accept waiting on GitHub's squash merge took 72 s, so it was
    killed half done. From the window an action here runs as its own job (`herdr-task --detach`) answering within the
    wait; still running, PENDING with machine "", followed with `herdr-task _job` (core/pending.js). Real processes,
    a throwaway TMPDIR for the jobs' files and a slow stand-in for herdr-task."""

    def setUp(self):
        import shutil
        self.dir = tempfile.mkdtemp(prefix="shepherdr-detach-")
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.env = dict(os.environ, TMPDIR=self.dir, HERDR_TASK_ACTION_WAIT="0.5", PYTHONDONTWRITEBYTECODE="1")
        self.slow = os.path.join(self.dir, "slow-herdr-task")
        with open(self.slow, "w") as f:
            f.write('#!/bin/sh\nsleep 2\necho "{\\"id\\": 1, \\"state\\": \\"done\\", \\"args\\": \\"$*\\"}"\n')
        os.chmod(self.slow, 0o755)

    def py(self, code, *argv):
        return subprocess.run([sys.executable, "-c", f"import sys; sys.path.insert(0, {BIN!r}); {code}", *argv],
                              env=self.env, capture_output=True, text=True, timeout=30)

    def test_a_slow_action_is_pending_then_followed_to_its_result(self):
        r = self.py("from herdr_task import link; r = link.local_action(['accept', '1', '--json'], sys.argv[1]); "
                    "print(r.returncode); print(r.stdout, end='')", self.slow)
        code, _, out = r.stdout.partition("\n")
        self.assertEqual(int(code), 75, r.stderr)
        job = json.loads(out)
        self.assertEqual(job["machine"], "")
        self.assertIn(f"herdr-task _job {job['pending']}", job["error"])
        # the caller is gone (the window stopped it): the action carries on, and _job gives its real result
        self.env["HERDR_TASK_ACTION_WAIT"] = "10"
        r = subprocess.run([sys.executable, os.path.join(BIN, "herdr-task"), "_job", job["pending"], "--json"],
                           env=self.env, capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout), {"id": 1, "state": "done", "args": "accept 1 --json"})

    def test_a_quick_action_answers_as_itself(self):
        folder = os.path.join(self.dir, "folder")
        os.makedirs(folder)
        self.env["HERDR_TASK_ACTION_WAIT"] = "20"
        self.env["HERDR_TASK_STORE"] = os.path.join(self.dir, "store")
        r = subprocess.run([sys.executable, os.path.join(BIN, "herdr-task"), "--detach", "star", "99", "--json", "--folder", folder],
                           env=self.env, capture_output=True, text=True, timeout=30)
        plain = subprocess.run([sys.executable, os.path.join(BIN, "herdr-task"), "star", "99", "--json", "--folder", folder],
                               env=self.env, capture_output=True, text=True, timeout=30)
        self.assertEqual((r.returncode, r.stdout), (plain.returncode, plain.stdout))
        self.assertNotEqual(r.returncode, 0)

    def test_an_unknown_job_says_so(self):
        r = subprocess.run([sys.executable, os.path.join(BIN, "herdr-task"), "_job", "nope", "--json"],
                           env=self.env, capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 1)
        self.assertIn("No action nope here", json.loads(r.stdout)["error"])


class LinkActions(unittest.TestCase):
    """SHEP-227 (#1055, #1016): the person's action on another machine runs there as its own hc terminal (a dropped
    link doesn't end it) and its result is read back across a reconnect; still running, it's "pending" with a job to
    follow; a link that never comes back gets words that say what may have happened. hc is faked: a script of answers."""

    LOST = '{"error":{"kind":"unavailable","message":"lost the line to vmb during the call"}}'
    DOWN = '{"error":{"kind":"unavailable","message":"vmb is unreachable: cannot reach it"}}'

    def setUp(self):
        sys.dont_write_bytecode = True
        sys.path.insert(0, BIN)
        import herdr_task.link as link
        self.link = link
        self.calls = []
        self.saved = (link.run, link.time.sleep)
        link.time.sleep = lambda s: None
        os.environ["HERDR_TASK_ACTION_WAIT"] = "5"

    def tearDown(self):
        self.link.run, self.link.time.sleep = self.saved
        os.environ.pop("HERDR_TASK_ACTION_WAIT", None)
        sys.path.remove(BIN)

    def hc(self, starts, polls):
        """Fake hc: `hc run` answers from starts, `hc exec` (the poll) from polls; each (code, stdout, stderr)."""
        def run(argv, **k):
            self.calls.append(argv[1])
            seq = starts if argv[1] == "run" else polls
            code, out, err = seq.pop(0) if len(seq) > 1 else seq[0]
            return subprocess.CompletedProcess(argv, code, out, err)
        self.link.run = run

    def test_a_drop_mid_action_is_waited_out(self):
        result = json.dumps({"rc": 0, "out": '{"id": 1, "state": "done"}\n', "err": ""})
        self.hc([(0, '{"address":"vmb/t3"}', "")], [(0, "running\n", ""), (5, "", self.LOST), (5, "", self.LOST),
                                                     (0, "running\n", ""), (0, "done\n" + result, "")])
        r = self.link.action("vmb", ["accept", "1", "--json"])
        self.assertEqual((r.returncode, json.loads(r.stdout)), (0, {"id": 1, "state": "done"}))
        self.assertEqual(self.calls.count("run"), 1)   # started once, never again

    def test_its_own_failure_is_its_own(self):
        result = json.dumps({"rc": 1, "out": '{"error": "SHEP-1 is done. Reopen it first."}\n', "err": ""})
        self.hc([(0, "{}", "")], [(0, "done\n" + result, "")])
        r = self.link.action("vmb", ["start", "1", "--json"])
        self.assertEqual(r.returncode, 1)
        self.assertIn("Reopen it first", r.stdout)

    def test_still_running_is_pending_with_its_job(self):
        self.hc([(0, "{}", "")], [(0, "running\n", "")])
        os.environ["HERDR_TASK_ACTION_WAIT"] = "0.05"
        r = self.link.action("vmb", ["accept", "1", "--json"])
        out = json.loads(r.stdout)
        self.assertEqual((r.returncode, out["machine"]), (self.link.PENDING, "vmb"))
        self.assertIn(f"_job {out['pending']}", out["error"])
        self.assertIn("slow to answer", out["error"])

    def test_a_start_cut_off_starts_once_the_machine_says_it_never_began(self):
        result = json.dumps({"rc": 0, "out": "{}", "err": ""})
        self.hc([(5, "", self.LOST), (0, "{}", "")], [(5, "", self.LOST), (0, "none\n", ""), (0, "none\n", ""),
                                                      (0, "running\n", ""), (0, "done\n" + result, "")])
        r = self.link.action("vmb", ["edit", "1", "--title", "x", "--json"])
        self.assertEqual(r.returncode, 0)
        self.assertEqual(self.calls.count("run"), 2)

    def test_a_start_cut_off_that_had_begun_runs_once(self):
        result = json.dumps({"rc": 0, "out": "{}", "err": ""})
        self.hc([(5, "", self.LOST)], [(0, "running\n", ""), (0, "done\n" + result, "")])
        self.assertEqual(self.link.action("vmb", ["merge", "1", "--json"]).returncode, 0)
        self.assertEqual(self.calls.count("run"), 1)

    def test_a_link_that_never_comes_back_says_what_may_have_happened(self):
        os.environ["HERDR_TASK_ACTION_WAIT"] = "0.05"
        self.hc([(5, "", self.DOWN)], [(5, "", self.DOWN)])
        r = self.link.action("vmb", ["accept", "1"])
        self.assertEqual(r.returncode, 1)
        self.assertIn("Can't reach vmb", r.stderr)
        self.assertIn("nothing was run there", r.stderr)
        self.hc([(5, "", self.LOST)], [(5, "", self.DOWN)])
        r = self.link.action("vmb", ["accept", "1", "--json"])
        self.assertIn("it may have run there", json.loads(r.stdout)["error"])
        # started, then the link went: it keeps running there, followed later with its job
        self.hc([(0, "{}", "")], [(5, "", self.LOST)])
        r = self.link.action("vmb", ["accept", "1", "--json"])
        self.assertEqual(r.returncode, self.link.PENDING)
        self.assertIn("its link dropped", json.loads(r.stdout)["error"])

    def test_a_late_poll_gets_only_the_time_left(self):
        """#1108: each poll may take its whole --timeout there: one started near the deadline gets only what is left,
        so the answer comes before the window's 30 s, never a full 15 s poll past a 25 s deadline."""
        clock = [0.0]
        saved = self.link.time.monotonic
        self.link.time.monotonic = lambda: clock[0]
        self.addCleanup(setattr, self.link.time, "monotonic", saved)
        self.link.time.sleep = lambda s: clock.__setitem__(0, clock[0] + s)
        os.environ["HERDR_TASK_ACTION_WAIT"] = "25"
        ends = []

        def run(argv, **k):
            if argv[1] == "run":
                return subprocess.CompletedProcess(argv, 0, "{}", "")
            t = int(argv[argv.index("--timeout") + 1])
            ends.append(clock[0] + t)
            clock[0] += t   # a slow machine: every poll takes all it is given
            return subprocess.CompletedProcess(argv, 0, "running\n", "")
        self.link.run = run
        r = self.link.action("vmb", ["accept", "1", "--json"])
        self.assertEqual(r.returncode, self.link.PENDING)
        self.assertLessEqual(max(ends), 26)
        self.assertLessEqual(clock[0], 26)

    def test_seen_running_then_the_link_goes_is_pending(self):
        """#1108: a start whose reply was lost, then seen running there, is known to have started: the deadline says
        pending (follow its job), never "it may have run there" (exit 1)."""
        os.environ["HERDR_TASK_ACTION_WAIT"] = "0.05"
        self.hc([(5, "", self.LOST)], [(0, "running\n", ""), (5, "", self.LOST)])
        r = self.link.action("vmb", ["accept", "1", "--json"])
        self.assertEqual(r.returncode, self.link.PENDING)
        self.assertIn("pending", json.loads(r.stdout))

    def test_a_job_started_twice_runs_once(self):
        """#1108: a start whose reply was lost may have begun there; started again with the same job, it runs nothing
        (the first one claimed the job's files)."""
        with tempfile.TemporaryDirectory() as d:
            prog = os.path.join(d, "fake-herdr-task")
            with open(prog, "w") as f:
                f.write('#!/bin/sh\necho ran >> "$TMPDIR/count"; echo "{}"\n')
            os.chmod(prog, 0o755)
            env = dict(os.environ, TMPDIR=d)
            for _ in range(2):
                subprocess.run(["sh", "-c", self.link.RUN, "sh", "job1", prog, "accept", "1"], env=env, check=True)
            with open(os.path.join(d, "count")) as f:
                self.assertEqual(f.read(), "ran\n")
            out = subprocess.run(["python3", "-c", self.link.POLL, "job1"], env=env, capture_output=True, text=True).stdout
            self.assertEqual(json.loads(out.split("\n", 1)[1])["rc"], 0)

    def test_hc_refusing_is_said_as_it_was(self):
        self.hc([(4, "", '{"error":{"kind":"machine_unknown","message":"unknown machine \\"vmb\\""}}')], [(0, "", "")])
        r = self.link.action("vmb", ["accept", "1"])
        self.assertEqual(r.returncode, 4)
        self.assertEqual(self.calls, ["run"])

    def test_reads_run_again_once_the_link_is_back(self):
        answers = [(5, "", self.LOST), (5, "", self.DOWN), (0, "[]", "")]
        r = self.link.again("vmb", ["list"], lambda: subprocess.CompletedProcess([], *answers.pop(0)))
        self.assertEqual((r.returncode, r.stdout), (0, "[]"))
        self.assertFalse(self.link.lost(subprocess.CompletedProcess([], 1, "", "herdr-task: no such task")))


class Systemic(unittest.TestCase):
    """SHEP-270 (#1195, #1174): one failing check behind several tasks (a red base, or one check failing
    merge-queue groups for several pull requests): the Assistant hears once, the tasks' fix requests wait
    until the base is green again, and a pull request dropped only because its group failed goes back in
    the queue once. GitHub is faked; gh and hc never run."""
    setUp_flow, patch, git, commit = TaskFlow.setUp, TaskFlow.patch, TaskFlow.git, TaskFlow.commit

    def setUp(self):
        self.setUp_flow()
        from herdr_task import systemic, tick, ghnews, github
        self.systemic, self.tick, self.ghnews = systemic, tick, ghnews
        self.clock = [100_000_000]
        for mod in (systemic, tick, ghnews, github):
            self.patch(mod, "now", lambda: self.clock[0])
        self.groups = []      # merge-group runs: (sha, prs, failed checks)
        self.queue = {}       # pr number -> {"state", "in"}
        self.base = {"head": "m1", "red": None, "checks": []}
        self.merges, self.sent = [], []

        def gh(*a, **k):
            if a[:2] == ("run", "list"):
                return True, json.dumps([{"headBranch": f"gh-readonly-queue/main/pr-{prs[-1]}-x", "headSha": sha,
                                          "status": "completed", "conclusion": "failure", "workflowName": "Check",
                                          "createdAt": "2026-11-21T10:00:00Z"} for sha, prs, _ in self.groups]), ""
            if a[0] == "api" and "/compare/" in a[1]:
                sha = a[1].rsplit("...", 1)[1]
                prs = next(p for s, p, _ in self.groups if s == sha)
                return True, json.dumps([f"Work {n} (#{n})" for n in prs]), ""
            if a[:2] == ("api", "graphql"):
                return True, json.dumps({"data": {"repository": {f"p{n}": {"state": q["state"], "isInMergeQueue": q["in"],
                                                                            "autoMergeRequest": None} for n, q in self.queue.items()}}}), ""
            return False, "", "unexpected"
        self.patch(systemic, "gh", gh)
        self.patch(systemic, "check_rows", lambda repo, sha: ([{"name": c, "conclusion": "FAILURE"} for s, _, cs in self.groups
                                                               if s == sha for c in cs] or
                                                              [{"name": c, "conclusion": "FAILURE"} for c in self.base["checks"]], True))
        self.patch(systemic, "base_history", lambda repo, base: (
            [self.base["head"], "m0"],
            [{"headSha": self.base["red"] or self.base["head"], "status": "completed",
              "conclusion": "failure" if self.base["red"] else "success", "url": "u", "workflowName": "Check"}]))
        self.patch(systemic, "queue_merge", lambda t, head: (self.merges.append((t["id"], head)), (True, ""))[1])
        self.patch(systemic, "coordinator_in", lambda space: "coord" if space else None)
        self.patch(systemic, "news_send", lambda to, text: self.sent.append(text) or True)
        self.patch(systemic, "queue_entry", lambda t: {"in": False, "auto": False, "state": "OPEN"})
        self.task.update(state="ready", space="sp1", pr={"number": 7, "url": "u7", "repo": "o/r"})

    def other(self, i, n):
        t = {"id": i, "title": f"Task {i}", "state": "ready", "mode": "worktree", "worktree": "/nowhere", "branch": f"task/{i}",
             "base": "main", "space": "sp1", "agents": [], "pr": {"number": n, "url": f"u{n}", "repo": "o/r"}}
        self.store.data["tasks"].append(t)
        return t

    def drop(self, t, head="abc", checks=()):
        """GitHub's merge queue just dropped t's pull request for failed checks."""
        self.patch(self.tick, "queue_entry", lambda t: {"in": False, "auto": False, "reason": "FAILED_CHECKS", "state": "OPEN"})
        t["merge_queued"] = self.clock[0] - 10 * 60000
        report = {"attention": []}
        v = {"state": "OPEN", "headRefOid": head, "mergeable": "MERGEABLE", "statusCheckRollup": list(checks)}
        self.tick.queue_pass(self.store, t, v, report)
        return report

    def test_a_pull_request_dropped_with_its_group_goes_back_once(self):
        """#1174: #3 failed the group it shared with #7; #7's own checks pass: queued again once, no Needs you."""
        self.groups = [("g1", [3, 7], ["unit"])]
        self.queue = {3: {"state": "OPEN", "in": False}}
        report = self.drop(self.task)
        self.assertEqual((self.merges, self.task.get("attention"), report.get("requeued")), ([(1, "abc")], None, ["SHEP-1"]))
        self.assertTrue(self.task.get("merge_queued"))
        # Dropped again at the same commit: its own doing now, Needs you.
        self.drop(self.task)
        self.assertEqual(len(self.merges), 1)
        self.assertTrue(self.task["attention"].startswith("GitHub's merge queue removed it"))

    def test_the_one_ahead_merged_so_the_failure_is_its_own(self):
        """The other pull request in its group merged (its own group passed): #7 broke its group: Needs you."""
        self.groups = [("g1", [3, 7], ["unit"])]
        self.queue = {3: {"state": "MERGED", "in": False}}
        self.drop(self.task)
        self.assertEqual(self.merges, [])
        self.assertEqual(self.task["attention"], "GitHub's merge queue removed it: FAILED_CHECKS.")
        self.assertEqual(self.task["queue_fail"]["checks"], ["unit"])

    def test_one_check_failing_several_groups_is_one_systemic_event(self):
        """#1215's night: one check fails the groups of #7, then #8 and #9, each alone: one systemic news naming the
        check and the tasks, no Needs you; once main moved on and isn't red, each goes back in the queue once."""
        self.groups = [("g1", [7], ["help-corpus"])]
        self.drop(self.task)
        self.assertTrue(self.task["attention"].startswith("GitHub's merge queue removed it"))  # one failure: its own, so far
        t8, t9 = self.other(2, 8), self.other(3, 9)
        self.groups.append(("g2", [8], ["help-corpus"]))
        self.drop(t8, head="h8")
        self.groups.append(("g3", [9], ["help-corpus"]))
        self.drop(t9, head="h9")
        for t in (self.task, t8, t9):
            self.assertNotIn("attention", t)
            self.assertIn("base_hold", t)
        report = {}
        self.tick.systemic_pass(self.store, report)
        self.assertEqual(self.sent, [])  # settles first, so the rest join
        self.clock[0] += 2 * 60000
        self.tick.systemic_pass(self.store, report)
        self.tick.systemic_pass(self.store, report)
        self.assertEqual(len(self.sent), 1)
        news = self.sent[0]
        self.assertTrue(news.startswith('<herdr-news event="systemic" branch="main">'))
        for words in ('"help-corpus"', "SHEP-1", "SHEP-2", "SHEP-3", "#7, #8, #9"):
            self.assertIn(words, news)
        # main moved on (a group passed and merged), not red: the three go back in the queue, once.
        self.base["head"] = "m2"
        self.clock[0] += 3 * 60000
        self.tick.systemic_pass(self.store, report)
        self.assertEqual(sorted(self.merges), [(1, "abc"), (2, "h8"), (3, "h9")])
        self.assertIn('event="systemic-over"', self.sent[1])
        self.assertNotIn("hold", self.store.data["systemic"]["main"])
        self.assertFalse(any(t.get("base_hold") for t in self.store.data["tasks"]))

    def test_main_red_holds_the_failing_check_news_and_needs_you(self):
        """#1195 1: main is red on the same test: the task's failing check neither goes to its agent nor makes it
        Needs you; once main is green, it does."""
        from herdr_task import ghnews
        self.base.update(red="m1", checks=["unit"])
        failing = [{"name": "unit", "status": "COMPLETED", "conclusion": "FAILURE", "detailsUrl": "d"}]
        v = {"state": "OPEN", "headRefOid": "abc", "mergeable": "MERGEABLE", "statusCheckRollup": failing}
        self.patch(ghnews, "resting", lambda s, t: {"address": "t1"})
        self.patch(ghnews, "pr_comments", lambda repo, n: [])
        self.patch(ghnews, "log_tail", lambda repo, rid: None)
        self.task["ready_at"] = 1
        ghnews.pr_news(self.store, self.task, v, {})
        self.assertNotIn("news", self.task["pr"])
        self.assertTrue(ghnews.held_by_base(self.store, self.task, v))
        self.assertIn("base_hold", self.task)
        # A check main doesn't fail is the task's own: news as before.
        own = failing + [{"name": "lint", "status": "COMPLETED", "conclusion": "FAILURE", "detailsUrl": "d2"}]
        self.assertFalse(ghnews.held_by_base(self.store, self.task, {**v, "statusCheckRollup": own}))
        # Green again: let go, and the failure (if still there) reaches its agent.
        self.base.update(red=None, checks=[], head="m2")
        self.clock[0] += 3 * 60000
        self.tick.systemic_pass(self.store, {})
        self.assertNotIn("base_hold", self.task)
        self.assertEqual(self.merges, [])  # never dropped from a queue: nothing to queue again
        self.clock[0] += 3 * 60000
        ghnews.pr_news(self.store, self.task, v, {})
        self.assertIn('Check "unit" failed', self.task["pr"]["news"]["text"])

    def test_a_hold_runs_out(self):
        """Main stays red for hours: the hold lets go anyway, a dropped pull request then Needs you."""
        self.base.update(red="m1", checks=["unit"])
        self.groups = [("g1", [7], ["unit"])]
        self.drop(self.task)
        self.assertIn("base_hold", self.task)
        self.assertNotIn("attention", self.task)
        self.clock[0] += 7 * 3600000
        self.tick.systemic_pass(self.store, {})
        self.assertEqual(self.merges, [])
        self.assertTrue(self.task["attention"].startswith("GitHub's merge queue removed it"))

    def test_its_own_failed_group_is_never_queued_again_as_it_is(self):
        """#1174: #7 failed its own merge group (the one ahead merged): an Accept doesn't queue it again at that commit,
        and its agent hears to merge main in; a new commit can go in again."""
        from herdr_task import ghnews
        self.groups = [("g1", [3, 7], ["unit"])]
        self.queue = {3: {"state": "MERGED", "in": False}}
        self.drop(self.task)
        self.assertEqual(self.task["queue_out"]["head"], "abc")
        # Its agent hears it, once: merge main in, don't queue it.
        self.patch(ghnews, "resting", lambda s, t: {"address": "t1"})
        self.patch(ghnews, "pr_comments", lambda repo, n: [])
        self.task["ready_at"] = 1
        v = {"state": "OPEN", "headRefOid": "abc", "mergeable": "MERGEABLE",
             "statusCheckRollup": [{"name": "unit", "status": "COMPLETED", "conclusion": "SUCCESS"}]}
        ghnews.pr_news(self.store, self.task, v, {})
        text = self.task["pr"].pop("news")["text"]
        self.assertIn("merge queue dropped it at this commit", text)
        self.assertIn("merge main into your branch", text)
        ghnews.pr_news(self.store, self.task, v, {})
        self.assertNotIn("news", self.task["pr"])  # once per commit
        # The person's Accept (or merge after checks): refused, no gh merge.
        calls = []
        self.patch(self.commands, "pr_view", lambda t: v)
        self.patch(self.commands, "gh", lambda *a, **k: (calls.append(a), (True, "", ""))[1])
        self.patch(self.commands, "note_checks", lambda *a: None)
        why = self.commands.merge_now(self.store, self.task)
        self.assertIn("dropped it at this same commit", why)
        self.assertEqual((calls, self.task["attention"]), ([], why))
        self.assertNotIn("merge_queued", self.task)
        # Main merged in: a new commit queues as before.
        v = {**v, "headRefOid": "def"}
        self.assertEqual(self.commands.merge_now(self.store, self.task), self.commands.IN_QUEUE)
        self.assertEqual(len(calls), 1)

    def outside(self, v, entry):
        """One tick over the task, its pull request v, its queue entry (put there from outside Herdr); what GitHub was asked."""
        asked = []
        self.patch(self.tick, "queue_entry", lambda t: dict(entry))
        self.patch(self.tick, "unqueue", lambda q: (asked.append(q["id"]), (True, None))[1])
        self.patch(self.tick, "pr_view", lambda t: v)
        self.patch(self.tick, "pr_news", lambda *a: None)
        self.task["pr"]["checked"] = 0
        report = {"attention": [], "done": []}
        self.tick.facts(self.store, self.task, report)
        return asked, report

    def test_queued_again_from_outside_after_its_group_failed_comes_out_once(self):
        """#1174: an agent (or the Assistant) puts it back in the queue by hand at the commit whose group just failed:
        taken out again, Needs you stays; a second time at that commit is the person's call (followed)."""
        self.groups = [("g1", [7], ["unit"])]
        self.drop(self.task)
        attention = self.task["attention"]
        v = {"state": "OPEN", "headRefOid": "abc", "mergeable": "MERGEABLE", "statusCheckRollup": []}
        entry = {"in": True, "auto": False, "state": "OPEN", "id": "PR_n7", "mergeable": "MERGEABLE"}
        asked, report = self.outside(v, entry)
        self.assertEqual((asked, report.get("unqueued"), self.task["attention"]), (["PR_n7"], ["SHEP-1"], attention))
        self.assertNotIn("merge_queued", self.task)
        asked, report = self.outside(v, entry)
        self.assertEqual(asked, [])
        self.assertNotIn("attention", self.task)  # back_in_queue followed it: Merging
        self.assertTrue(self.task.get("merge_queued"))

    def test_a_conflicting_pull_request_never_sits_in_the_queue(self):
        """#1174: a pull request that conflicts with main sitting in (or set to join) the queue, as UNMERGEABLE: taken out,
        each time; its agent hears of the conflict as before (pr_news)."""
        v = {"state": "OPEN", "headRefOid": "abc", "mergeable": "CONFLICTING", "statusCheckRollup": []}
        for entry in ({"in": True, "auto": False, "state": "OPEN", "id": "PR_n7"}, {"in": False, "auto": True, "state": "OPEN", "id": "PR_n7"}):
            asked, _ = self.outside(v, entry)
            self.assertEqual(asked, ["PR_n7"])
            self.assertEqual(self.task["attention"], "It conflicts with the base branch.")
        # Nothing wrong with it: a pull request queued by hand is left alone.
        self.task.pop("attention")
        asked, _ = self.outside({**v, "mergeable": "MERGEABLE"}, {"in": True, "auto": False, "state": "OPEN", "id": "PR_n7"})
        self.assertEqual(asked, [])

    def test_a_hold_ending_never_queues_a_conflicting_pull_request(self):
        """#1174: main green again, but the held pull request now conflicts with it: not queued again; Needs you."""
        self.base.update(red="m1", checks=["unit"])
        self.groups = [("g1", [7], ["unit"])]
        self.drop(self.task)
        self.assertIn("base_hold", self.task)
        self.patch(self.systemic, "queue_entry", lambda t: {"in": False, "auto": False, "state": "OPEN", "mergeable": "CONFLICTING"})
        self.base.update(red=None, checks=[], head="m2")
        self.clock[0] += 3 * 60000
        self.tick.systemic_pass(self.store, {})
        self.assertEqual(self.merges, [])
        self.assertTrue(self.task["attention"].startswith("GitHub's merge queue removed it"))

class AcceptCommand(unittest.TestCase):
    """#1102, SHEP-275: a space's "When a task is accepted" command (tasks.accept_command) runs once a
    task is done, in the background, in its repo, with the task named in env vars; a failure is kept on
    the task and told to its Assistant, and the task stays done. A throwaway repo and settings file;
    hc is never run."""

    def setUp(self):
        import shutil
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.after_accept as aa
        import herdr_task.github as github
        import herdr_task.settings as settings
        self.aa, self.github, self.mock = aa, github, mock
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.main = os.path.join(self.tmp, "repo")
        os.makedirs(self.main)
        self.settings = os.path.join(self.tmp, "shepherdr.json")
        self.store = Store([{"id": 4, "title": "Test databases", "state": "ready", "mode": "worktree", "space": "sp1",
                             "worktree": os.path.join(self.tmp, "wt"), "branch": "task/4-test-databases", "base": "main"}])
        self.store.loc["folder"] = self.main
        self.task = self.store.data["tasks"][0]
        self.spawned = []
        for mod, name, value in ((settings, "SETTINGS", self.settings), (aa, "LOGS", os.path.join(self.tmp, "logs")),
                                 (aa, "spawn", lambda folder, i: self.spawned.append((folder, i))),
                                 (github, "mid_turn", lambda s, t: False), (github, "live_agents", lambda key: []),
                                 (github, "remove_worktree", lambda s, t: True)):
            p = mock.patch.object(mod, name, value)
            p.start()
            self.addCleanup(p.stop)

    def set_command(self, cmd, space=None, folder=None):
        layer = {"tasks": {"accept_command": cmd}, "folder": folder or self.main}
        with open(self.settings, "w") as f:
            json.dump({"spaces": {space: layer}} if space else {"everywhere": layer}, f)

    def run_it(self):
        """What `herdr-task _after-accept` does in the background, on this test's store."""
        import herdr_task.store as store
        with self.mock.patch.object(store, "Store", lambda loc: self.store), self.mock.patch.object(store, "locate", lambda f: self.store.loc):
            self.aa.cmd_after_accept(type("A", (), {"id": "4", "folder": self.main})())
        return self.task["after_accept"]

    def test_nothing_runs_without_a_command(self):
        self.github.finish(self.store, self.task)
        self.assertEqual(self.task["state"], "done")
        self.assertNotIn("after_accept", self.task)
        self.assertEqual(self.spawned, [])

    def test_a_spaces_command_starts_once_as_the_task_is_done(self):
        self.set_command("echo hi", space="sp1")
        self.github.finish(self.store, self.task)
        self.assertEqual(self.task["state"], "done")
        self.assertEqual(self.task["after_accept"]["state"], "running")
        self.assertEqual(self.spawned, [(self.main, 4)])
        self.github.finish(self.store, self.task)        # done again (a second merge pass): never twice
        self.assertEqual(len(self.spawned), 1)

    def test_another_spaces_command_isnt_this_ones(self):
        self.set_command("echo hi", space="sp2", folder=os.path.join(self.tmp, "other"))
        self.github.finish(self.store, self.task)
        self.assertEqual(self.spawned, [])

    def test_it_runs_in_the_repo_with_the_task_named(self):
        self.set_command('printf "%s|%s|%s|%s|%s" "$HERDR_TASK_ID" "$HERDR_TASK_NUMBER" "$HERDR_TASK_BRANCH" "$HERDR_TASK_WORKTREE" "$(pwd -P)" > out.txt')
        self.github.finish(self.store, self.task)
        r = self.run_it()
        self.assertEqual((r["state"], r["code"]), ("ok", 0))
        with open(os.path.join(self.main, "out.txt")) as f:
            self.assertEqual(f.read(), f"SHEP-4|4|task/4-test-databases|{self.task['worktree']}|{os.path.realpath(self.main)}")
        self.assertEqual(self.task["state"], "done")

    def test_a_failure_is_kept_and_the_task_stays_done(self):
        self.set_command("echo dropping test_SHEP_4; echo 'dropdb: database is in use' >&2; exit 3")
        self.github.finish(self.store, self.task)
        r = self.run_it()
        self.assertEqual((self.task["state"], r["state"], r["code"]), ("done", "failed", 3))
        self.assertEqual(r["tail"], "dropping test_SHEP_4\ndropdb: database is in use")
        with open(r["log"]) as f:
            self.assertIn("dropdb: database is in use", f.read())
        self.assertEqual(self.aa.failure_words(r), "it ended with exit code 3: dropdb: database is in use")
        self.assertTrue(self.aa.describe(r).startswith("failed, it ended with exit code 3: dropdb: database is in use (all its output: "))

    def test_one_still_running_after_its_time_is_stopped(self):
        self.set_command("echo started; sleep 30")
        self.github.finish(self.store, self.task)
        with self.mock.patch.object(self.aa, "TIMEOUT_S", 1):
            r = self.run_it()
        with open(r["log"]) as f:
            self.assertIn("Stopped: still running", f.read())
        self.assertEqual((r["state"], r["code"]), ("failed", None))
        self.assertEqual(self.aa.failure_words(r), "it was still running after 10 min: started")

    def test_the_done_row_says_it_failed(self):
        """core/tasks.js secondLine(): a Done row's line, in the window and on the web."""
        r = subprocess.run(["node", "--input-type=module", "-e",
                            "import { secondLine } from './core/tasks.js';"
                            "const t = (aa) => secondLine({ section: 'done', task: { state: 'done', after_accept: aa } }, null);"
                            "console.log(JSON.stringify([t(undefined), t({ state: 'ok', code: 0 }),"
                            " t({ state: 'failed', code: 3, tail: 'dropping\\ndropdb: in use' }), t({ state: 'failed', code: null })]));"],
                           cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(json.loads(r.stdout), [None, None, "Cleanup failed (exit 3): dropdb: in use",
                                                "Cleanup failed: still running after 10 min"], r.stderr)


class AcceptCommandNews(unittest.TestCase):
    """SHEP-275: a failed "When a task is accepted" command is told to its space's Assistant once, as its
    own line (news.py). A throwaway news file; hc is never run."""

    def setUp(self):
        import shutil
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.assistant_settings as assistant_settings
        import herdr_task.news as news
        import herdr_task.reactions as reactions
        self.news = news
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.store = Store([{"id": 4, "title": "Test databases", "state": "done", "space": "sp1", "merged": True}])
        self.store.loc["folder"] = self.tmp
        self.task = self.store.data["tasks"][0]
        self.sent = []
        for mod, name, value in ((news, "NEWS", os.path.join(self.tmp, "news.json")), (news, "HELD", os.path.join(self.tmp, "held.json")),
                                 (news, "NEWS_SETTLE_MS", -1), (news, "store_files", lambda folder=None: ["/f.json"]),
                                 (news, "read_list", lambda p: {"folder": self.tmp, "tasks": self.store.data["tasks"]}),
                                 (news, "locate", lambda f: self.store.loc), (news, "Store", lambda loc, write=True: self.store),
                                 (news, "coordinator_in", lambda space: "asst-1"), (news, "hc_json", lambda *a: {}),
                                 (news, "news_send", lambda to, text, **k: self.sent.append((to, text)) or True),
                                 (assistant_settings, "settings_pass", lambda *a: None), (reactions, "reactions_pass", lambda *a: None)):
            p = mock.patch.object(mod, name, value)
            p.start()
            self.addCleanup(p.stop)

    def test_told_once(self):
        self.news.news_pass({})                     # a first look: old news isn't news
        self.task["after_accept"] = {"state": "failed", "code": 3, "tail": "dropdb: database is in use", "log": "/logs/f-4.log"}
        self.news.news_pass({})
        self.assertEqual(len(self.sent), 1)
        self.assertIn('event="accept-failed"', self.sent[0][1])
        self.assertIn('"Test databases" is done, but its "When a task is accepted" command failed: it ended with exit code 3: '
                      'dropdb: database is in use. All its output: /logs/f-4.log', self.sent[0][1].replace("&quot;", '"'))
        self.assertTrue(self.task["after_accept"]["told"])
        self.news.news_pass({})
        self.assertEqual(len(self.sent), 1)


class TildeNewsGoesToEverything(AcceptCommandNews):
    """3.2.8: this computer's own ~ space sits beside Everything in the home folder. A task in it is told to Everything,
    which keeps every task's news, once; never to the ~ space's own Assistant too. Throwaway files; hc is never run."""

    def setUp(self):
        from unittest import mock
        super().setUp()
        import herdr_task.launch as launch
        self.launch = launch
        here = [{"id": "home", "folder": launch.HOME}, {"id": "tilde", "folder": launch.HOME + "/"}, {"id": "sp1", "folder": "/srv/shop"}]
        for name, value in (("core_spaces", lambda: here), ("coordinator_in", lambda space: f"asst-{space}")):
            p = mock.patch.object(self.news, name, value)
            p.start()
            self.addCleanup(p.stop)

    def test_told_once(self):
        pass  # the parent's case, run there

    def test_which_is_which(self):
        H = self.launch.HOME
        self.assertEqual((self.launch.everything_of([{"id": "tilde", "folder": H}, {"id": "home", "folder": H}]),
                          self.launch.tilde_of([{"id": "tilde", "folder": H}, {"id": "home", "folder": H}])), ("home", "tilde"))
        self.assertEqual(self.launch.tilde_of([{"id": "home", "folder": H}, {"id": "sp9", "folder": "/srv"}]), None)
        self.assertEqual(self.launch.everything_of([{"id": "spz", "folder": H}, {"id": "spa", "folder": H}]), "spa")

    def test_a_task_in_tilde_is_told_to_everything(self):
        self.task["space"] = "tilde"
        self.news.news_pass({})
        self.task["after_accept"] = {"state": "failed", "code": 3, "tail": "x", "log": "/logs/f-4.log"}
        self.news.news_pass({})
        self.assertEqual([to for to, _ in self.sent], ["asst-home"])
        self.news.news_pass({})
        self.assertEqual(len(self.sent), 1, "told once")

    def test_another_space_keeps_its_own(self):
        self.news.news_pass({})
        self.task["after_accept"] = {"state": "failed", "code": 3, "tail": "x", "log": "/logs/f-4.log"}
        self.news.news_pass({})
        self.assertEqual([to for to, _ in self.sent], ["asst-sp1"])


class DiskHoldSaysWhatFillsIt(unittest.TestCase):
    """SHEP-275: a hold for a full disk names its biggest folders, found by du in the background and
    kept a while (queues.disk_top); never du in the hold itself. Throwaway files."""

    def setUp(self):
        import shutil
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.machine as machine
        import herdr_task.queues as queues
        import herdr_task.settings as settings
        self.queues, self.machine, self.mock = queues, machine, mock
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.spawned = []
        full = {"memory": 40, "load": 0.1, "cores": 4, "cpu": 3, "disk": 96,
                "disks": [{"path": "home", "pct": 96, "free_gb": 4}, {"path": "/tmp", "pct": 20, "free_gb": 80}]}
        for mod, name, value in ((settings, "SETTINGS", os.path.join(self.tmp, "shepherdr.json")),
                                 (queues, "HOLD_FILE", os.path.join(self.tmp, "machine-hold.json")),
                                 (queues, "DISK_TOP", os.path.join(self.tmp, "disk-top.json")), (queues, "HOME", "/home/demo"),
                                 (machine, "sample", lambda: full), (queues, "_hold", {})):
            p = mock.patch.object(mod, name, value)
            p.start()
            self.addCleanup(p.stop)
        self.queues.set_hold("vm-demo", {"start_disk": 90})

    def hold(self):
        self.queues._hold.clear()
        self.queues._hold.update(machine="vm-demo", limits={"start_disk": 90})
        return self.queues.machine_hold()

    def test_first_a_look_in_the_background_then_what_it_found(self):
        p = self.mock.patch.object(self.queues.subprocess, "Popen", lambda argv, **k: self.spawned.append(argv[2:]))
        p.start()
        self.addCleanup(p.stop)
        self.assertEqual(self.hold(), "vm-demo's disk is 96% full")
        self.assertEqual(self.spawned, [["_disk-top", "/home/demo"]])
        self.assertEqual(self.hold(), "vm-demo's disk is 96% full")   # still looking: not started again
        self.assertEqual(len(self.spawned), 1)
        top = [["/home/demo/dev", 120 * 2 ** 30, "/home/demo/dev/app"], ["/home/demo/.cache", 3 * 2 ** 29, None]]
        with self.mock.patch.object(self.machine, "biggest", lambda path: top), self.mock.patch.object(self.machine, "HOME", "/home/demo"):
            self.queues.cmd_disk_top(type("A", (), {"path": "/home/demo"})())
        self.assertEqual(self.hold(), "vm-demo's disk is 96% full (biggest: ~/dev 120 GB (mostly ~/dev/app), ~/.cache 1.5 GB)")
        self.assertEqual(len(self.spawned), 1)

    def test_biggest_reads_du(self):
        root = os.path.join(self.tmp, "home")
        for d, mb in (("dev/app", 3), ("dev/b", 1), ("cache", 1)):
            os.makedirs(os.path.join(root, d))
            with open(os.path.join(root, d, "f"), "wb") as f:
                f.write(os.urandom(mb * 2 ** 20))
        top = self.machine.biggest(root)
        self.assertEqual([(os.path.relpath(p, root), os.path.relpath(k, root) if k else None) for p, n, k in top],
                         [("dev", "dev/app"), ("cache", None)])
        self.assertGreaterEqual(top[0][1], 4 * 2 ** 20)


class CodexBatch278(unittest.TestCase):
    """SHEP-278: #1219 a task switched to Codex keeps the space's permission; #1228 the reviewer finds a Codex only
    the person's shell has (nvm: with its node); #1190 an old Codex is named, not started; #1227 nothing automatic is
    pasted into a Codex mid-turn and its input box is checked after a send; #1093 a Codex job ends on Codex's own
    word that its command ended, and ready names what it waits on. Fake CLIs and logs in temp folders; hc is faked."""

    def setUp(self):
        from unittest import mock
        sys.path.insert(0, BIN)
        from herdr_task import settings, launch, news, agents
        self.settings, self.launch, self.news, self.agents, self.mock = settings, launch, news, agents, mock
        self.dir = tempfile.mkdtemp()
        settings._cli.clear()
        settings._codex_old.clear()

    def patch(self, obj, name, value):
        p = self.mock.patch.object(obj, name, value)
        p.start()
        self.addCleanup(p.stop)

    def script(self, path, body):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(body)
        os.chmod(path, 0o755)
        return path

    # ---- #1219 -----------------------------------------------------------------------------------
    def worker(self, worker, task_agent="codex"):
        with open(os.path.join(self.dir, "settings.json"), "w") as f:
            json.dump({"everywhere": {"worker": worker}}, f)
        self.patch(self.settings, "SETTINGS", os.path.join(self.dir, "settings.json"))
        return self.settings.worker_argv(Store([]), {"id": 1, "title": "x", "agent": task_agent})

    def test_switch_to_codex_keeps_full_access(self):
        argv = self.worker({"agent": "claude", "perm": "bypassPermissions"})
        self.assertEqual(argv[0], "codex")
        self.assertIn("--dangerously-bypass-approvals-and-sandbox", argv)
        self.assertNotIn("workspace-write", argv)

    def test_switch_carries_each_mode_to_its_nearest(self):
        self.assertEqual(self.worker({"agent": "claude", "perm": "plan"})[-4:], ["-s", "read-only", "-a", "on-request"])
        self.assertIn("--dangerously-skip-permissions", self.worker({"agent": "codex", "perm": "full"}, "claude"))
        # a custom argv's mode is read off it
        self.assertIn("--dangerously-bypass-approvals-and-sandbox", self.worker({"argv": ["claude", "--dangerously-skip-permissions"]}))
        # Claude's Ask has no Codex match: Codex's own default (Auto)
        self.assertEqual(self.worker({"agent": "claude", "perm": "manual"})[-4:], ["-s", "workspace-write", "-a", "on-request"])
        self.assertIn("--dangerously-bypass-approvals-and-sandbox", self.settings.argv_for({"agent": "codex", "perm": "bypassPermissions"}))

    # ---- #1228 -----------------------------------------------------------------------------------
    def nvm(self, help_text="Usage: codex [OPTIONS]\n      --no-daemon\n"):
        """A Codex as npm installs it under nvm: a node script beside its node, found only by the person's shell."""
        bin_dir = os.path.join(self.dir, ".nvm", "versions", "node", "v22", "bin")
        self.script(os.path.join(bin_dir, "node"), '#!/bin/sh\n# stands in for node: runs the script it is given\nshift 0\nexec sh "$@"\n')
        self.script(os.path.join(bin_dir, "codex"), "#!/usr/bin/env node\n" + (
            'case "$1" in --help) printf %s "' + help_text + '";; --version) echo codex-cli 0.144.5;; *) echo codex-started "$@";; esac\n'))
        shell = self.script(os.path.join(self.dir, "fake-shell"),
                            f'#!/bin/sh\n# the person\'s interactive shell: nvm\'s folder on its PATH\nPATH="{bin_dir}:$PATH"; export PATH\nshift\nexec /bin/sh -c "$@"\n')
        self.patch(self.settings.shutil, "which", lambda name: None)
        self.patch(os, "environ", dict(os.environ, SHELL=shell))
        return bin_dir

    def test_reviewer_command_brings_nvm_s_folder(self):
        bin_dir = self.nvm()
        cmd = self.settings.reviewer_command("codex")
        self.assertTrue(cmd.startswith(f'env "PATH={bin_dir}:$PATH" codex --no-daemon --sandbox read-only'), cmd)
        # as hc run starts it: a bare PATH. The brief's command starts; the bare name doesn't.
        bare = {"PATH": "/usr/bin:/bin", "HOME": self.dir}
        ok = subprocess.run(["sh", "-c", cmd.replace("--sandbox", "x --sandbox", 1).split(" --no-daemon")[0] + " --version"],
                            env=bare, capture_output=True, text=True)
        self.assertEqual(ok.stdout.strip(), "codex-cli 0.144.5", ok.stderr)
        bad = subprocess.run(["sh", "-c", "codex --version"], env=bare, capture_output=True, text=True)
        self.assertNotEqual(bad.returncode, 0)

    def test_claude_in_the_system_folders_needs_nothing(self):
        self.patch(self.settings.shutil, "which", lambda name: f"/usr/bin/{name}")
        self.assertEqual(self.settings.reviewer_command("claude"),
                         'env ${CLAUDE_CONFIG_DIR:+"CLAUDE_CONFIG_DIR=$CLAUDE_CONFIG_DIR"} claude --permission-mode dontAsk --tools=Read,Grep,Glob,Bash --strict-mcp-config')

    # ---- #1131 #1181 -----------------------------------------------------------------------------
    def test_a_claude_reviewer_gets_the_workers_profile_never_plan_mode(self):
        """#1131: hc run gives the reviewer hc's environment, so the brief's command carries the worker's own
        CLAUDE_CONFIG_DIR, expanded by the worker's shell; none when the worker has none (an empty one is not ~/.claude).
        #1181: read-only without plan mode, the prompt after its tools never taken as one."""
        bin_dir = os.path.join(self.dir, "claudebin")
        self.script(os.path.join(bin_dir, "claude"), '#!/bin/sh\necho "dir=${CLAUDE_CONFIG_DIR-unset}"; for a in "$@"; do echo "arg=$a"; done\n')
        self.patch(self.settings.shutil, "which", lambda name: os.path.join(bin_dir, name))
        cmd = self.settings.reviewer_command("claude", "opus", "high") + ' "review it"'
        self.assertNotIn("plan", cmd)
        for given, want in (({"CLAUDE_CONFIG_DIR": "/app/my claude"}, "dir=/app/my claude"), ({}, "dir=unset")):
            out = subprocess.run(["sh", "-c", cmd], env={"PATH": "/usr/bin:/bin", "HOME": self.dir, **given}, capture_output=True, text=True).stdout
            self.assertEqual(out.splitlines()[0], want, out)
            self.assertIn("arg=--tools=Read,Grep,Glob,Bash", out)
            self.assertEqual(out.splitlines()[-1], "arg=review it")

    def test_a_codex_worker_s_review_run_is_still_its_own(self):
        bin_dir = self.nvm()
        self.patch(os, "environ", dict(os.environ, HERDR_BROWSER_TASK="x-1"))
        run = ('hc run --bg --name x-1-review --label "herdr.task=$HERDR_BROWSER_TASK" --label herdr.role=reviewer '
               '--label herdr.agent=codex -- ' + self.settings.reviewer_command("codex") + ' "review it"')
        self.assertTrue(self.launch.own_command("/x/herdr-task", run, sandboxed=True))
        # another folder first on its PATH is not the brief's reviewer
        self.assertFalse(self.launch.own_command("/x/herdr-task", run.replace(bin_dir, "/tmp/evil"), sandboxed=True))

    # ---- #1190 -----------------------------------------------------------------------------------
    def test_an_old_codex_is_named_not_started(self):
        self.nvm(help_text="Usage: codex [OPTIONS]\n      --sandbox\n")
        old = self.settings.codex_too_old()
        self.assertIn("codex-cli 0.144.5", old)
        words = self.settings.codex_update_words(old)
        self.assertIn("Update it", words)
        self.assertIn("npm install -g @openai/codex@latest", words)
        t = {"id": 1, "title": "x", "mode": "here", "agents": []}

        class S:
            loc = {"folder": self.dir, "kind": "folder"}
            key = ref = lambda self, t: "X-1"
        with self.assertRaises(self.settings.Fail) as e:
            self.launch.launch(S(), t, ["codex", "--no-daemon"], "sp1")
        self.assertIn("too old", str(e.exception))

    def test_an_old_codex_never_reviews(self):
        self.nvm(help_text="Usage: codex [OPTIONS]\n")
        self.patch(self.settings, "cli_here", lambda kind: "ready")
        with open(os.path.join(self.dir, "settings.json"), "w") as f:
            json.dump({"everywhere": {"tasks": {"review_rounds": 2}, "reviewer": {"agent": "codex"}}}, f)
        self.patch(self.settings, "SETTINGS", os.path.join(self.dir, "settings.json"))
        t = {"id": 1, "title": "x", "mode": "worktree"}
        r = next(x for x in self.settings.task_settings(Store([t]), t, argv=["claude"]) if x["label"] == "Reviewer")
        self.assertEqual(r["value"]["agent"], "claude")
        self.assertIn("Codex here is too old", r["text"])

    def test_a_new_codex_passes(self):
        self.nvm()
        self.assertIsNone(self.settings.codex_too_old())

    # ---- #1227 -----------------------------------------------------------------------------------
    def fake_hc(self, k, screens):
        sent = []
        self.patch(self.news, "hc_json", lambda *a: k)
        self.patch(self.news, "typing", lambda *a, **kw: None)
        self.patch(self.news.time, "sleep", lambda s: None)
        self.patch(self.news, "guard", lambda a: None)
        it = iter(screens)

        def run(args, **kw):
            sent.append(args[1:])
            from types import SimpleNamespace
            return SimpleNamespace(returncode=0, stdout=next(it, screens[-1]) if args[1] == "read" else "", stderr="")
        self.patch(self.news, "run", run)
        self.patch(self.news.subprocess, "run", lambda args, **kw: (sent.append(args[1:]), run(args))[1])
        return sent

    CODEX = {"state": "live", "labels": {"herdr.agent": "codex"}, "status": {"app": "codex", "state": "working"}}

    # ---- SHEP-306: Claude Code mid-turn steers (Ctrl+Enter) only on its queued sign, only while it works ----------------
    CLAUDE = {"state": "live", "labels": {"herdr.agent": "claude"}, "status": {"app": "claude-code", "state": "working"}}
    # Claude Code 2.1.330's real screen right after a message went in mid-turn (45 columns)
    QUEUED_2_1_330 = ("❯ what number now?\n  ⎿  Queued · ctrl+enter to send now\n✻ Skedaddling… (19s · ↓ 162 tokens)\n"
                      "─────────────────────────────────────────────\n❯ Press up to edit queued messages\n"
                      "─────────────────────────────────────────────\n  ⏵⏵ bypass permissions on · esc to interrupt")
    WORKING = "✻ Skedaddling… (19s)\n──────\n❯ \n──────\n  ⏵⏵ bypass permissions on · esc to interrupt"

    def test_claude_mid_turn_steers_on_its_queued_sign(self):
        sent = self.fake_hc(self.CLAUDE, [self.QUEUED_2_1_330])
        self.assertTrue(self.news.news_send("t9", "Change of plan: stop"))
        self.assertIn(["keys", "t9", "ctrl+enter"], sent)
        # a sign that shows late (a slow machine) still gets its Ctrl+Enter
        sent = self.fake_hc(self.CLAUDE, [self.WORKING] * 6 + ["❯ Press up to edit queued messages"])
        self.assertTrue(self.news.news_send("t9", "Change of plan: stop"))
        self.assertEqual(sent.count(["keys", "t9", "ctrl+enter"]), 1)

    def test_claude_without_a_queued_message_gets_no_ctrl_enter(self):
        sent = self.fake_hc(self.CLAUDE, [self.WORKING])
        self.assertTrue(self.news.news_send("t9", "Change of plan: stop"))
        self.assertFalse(any(a[0] == "keys" for a in sent))

    def test_nothing_is_pasted_into_a_working_codex(self):
        sent = self.fake_hc(self.CODEX, [""])
        self.assertFalse(self.news.news_send("t9", "Change of plan: stop"))
        held = []
        self.patch(self.news, "hold", lambda *a: held.append(a))
        self.assertEqual(self.news.send_or_hold("t9", "Change of plan: stop"), "held")
        self.assertEqual(sent, [])
        self.assertEqual(held, [("t9", "Change of plan: stop", "send")])

    def test_a_draft_left_for_the_queue_is_queued(self):
        sent = self.fake_hc(dict(self.CODEX, status={"app": "codex", "state": "idle"}),
                            ["• Ran tests\n\n› hange of plan: stop\n  tab to queue message"])
        self.assertTrue(self.news.news_send("t9", "Change of plan: stop"))
        self.assertIn(["keys", "t9", "tab"], sent)

    def test_a_draft_still_in_the_box_is_sent_and_an_empty_box_left(self):
        sent = self.fake_hc(dict(self.CODEX, status={"app": "codex", "state": "idle"}), ["› hange of plan: stop the build\n  ? for shortcuts"])
        self.assertTrue(self.news.news_send("t9", "Change of plan: stop the build"))
        self.assertIn(["keys", "t9", "enter"], sent)
        sent = self.fake_hc(dict(self.CODEX, status={"app": "codex", "state": "idle"}),
                            ["› Change of plan: stop the build\n\n• Stopping it.\n\n› Ask Codex to do anything"])
        self.assertTrue(self.news.news_send("t9", "Change of plan: stop the build"))
        self.assertFalse([a for a in sent if a[0] == "keys"])

    # ---- SHEP-329: the person's reply is in within seconds, always -----------------------------------------------
    AFTER_ESC = ("  ⎿  Interrupted · What should Claude do instead?\n❯ Change of plan: stop\n✽ Cultivating… (1s)\n"
                 "──────\n❯ \n──────\n  ⏵⏵ bypass permissions on · esc to interrupt")

    def test_the_persons_reply_steers_and_falls_back_to_esc(self):
        # still queued after Ctrl+Enter's grace (5 s, 20 looks): Esc, once
        sent = self.fake_hc(self.CLAUDE, [self.QUEUED_2_1_330] * 21 + [self.AFTER_ESC])
        self.assertEqual(self.news.person_send("t9", "Change of plan: stop"), "sent")
        self.assertEqual([a for a in sent if a[0] == "keys"], [["keys", "t9", "ctrl+enter"], ["keys", "t9", "esc"]])
        # in by Ctrl+Enter: no Esc
        sent = self.fake_hc(self.CLAUDE, [self.QUEUED_2_1_330, self.WORKING])
        self.assertEqual(self.news.person_send("t9", "Change of plan: stop"), "sent")
        self.assertEqual([a for a in sent if a[0] == "keys"], [["keys", "t9", "ctrl+enter"]])

    def test_news_never_presses_esc(self):
        sent = self.fake_hc(self.CLAUDE, [self.QUEUED_2_1_330])
        self.assertTrue(self.news.news_send("t9", "SHEP-1 is ready"))
        self.assertEqual([a for a in sent if a[0] == "keys"], [["keys", "t9", "ctrl+enter"]])

    def test_the_persons_reply_goes_to_a_working_codex_now(self):
        held = []
        self.patch(self.news, "hold", lambda *a: held.append(a))
        sent = self.fake_hc(self.CODEX, ["› hange of plan: stop\n  tab to queue message"])
        self.assertEqual(self.news.person_send("t9", "Change of plan: stop"), "sent")
        self.assertEqual(held, [])
        self.assertIn(["send", "t9", "Change of plan: stop"], sent)
        # its "tab to queue" draft goes in now (Enter), never to the queue
        self.assertIn(["keys", "t9", "enter"], sent)
        self.assertNotIn(["keys", "t9", "tab"], sent)

    def test_the_persons_reply_waits_only_while_they_write_in_its_box(self):
        held = []
        self.fake_hc(self.CLAUDE, [self.WORKING])
        self.patch(self.news, "typing", lambda *a, **kw: "its box")
        self.patch(self.news, "hold", lambda *a: held.append(a))
        self.assertEqual(self.news.person_send("t9", "Change of plan: stop"), "held")
        self.assertEqual(held, [("t9", "Change of plan: stop")])

    # ---- #1093 #1143 -----------------------------------------------------------------------------
    def log(self, items):
        path = os.path.join(self.dir, "rollout.jsonl")
        with open(path, "w") as f:
            for i, d in enumerate(items):
                f.write(json.dumps(dict(d, timestamp=f"2026-11-20T10:00:{i:02d}Z")) + "\n")
        self.agents._bg_cache.clear()
        self.patch(self.agents, "now", lambda: 1_794_996_000_000 + 60_000)
        return path

    def call(self, cid, script):
        return {"type": "response_item", "payload": {"type": "custom_tool_call", "call_id": cid, "name": "exec", "input": script}}

    def out(self, cid, *results):
        return {"type": "response_item", "payload": {"type": "custom_tool_call_output", "call_id": cid, "output":
                [{"type": "input_text", "text": "Script completed\nOutput:\n"}] + [{"type": "input_text", "text": json.dumps(r)} for r in results]}}

    def completed(self, pid, status="completed"):
        return {"type": "event_msg", "payload": {"type": "item_completed", "item": {"type": "CommandExecution", "process_id": str(pid),
                "command": ["/bin/bash", "-lc", "x"], "source": "unified_exec_startup", "status": status, "exit_code": 0}}}

    def test_codex_s_own_word_ends_a_job_its_polls_never_matched(self):
        """A real shape (Codex 0.167): a CI watcher polled in batches, never seen to exit by a poll, then Codex's own
        item_completed for its process id. Before: it counted forever."""
        log = self.log([
            self.call("c1", 'text(await tools.exec_command({cmd:"gh pr checks 1035 --watch --interval 10","yield_time_ms":1000}));\n'
                            'text(await tools.exec_command({cmd:"npm test","yield_time_ms":1000}));\n'),
            self.out("c1", {"session_id": 95493, "output": "pending"}, {"session_id": 4711, "output": "..."}),
            self.call("c2", 'text(await tools.write_stdin({session_id:95493,chars:""}));\n'),
            self.out("c2", {"session_id": 95493, "output": "pending"}),
        ])
        self.assertEqual(sorted(self.agents.background_jobs(log)[0]), ["codex:4711", "codex:95493"])
        self.assertEqual(self.agents.job_names(log, ["codex:95493", "codex:4711"]),
                         ["`gh pr checks 1035 --watch --interval 10`", "`npm test`"])
        log = self.log([*[json.loads(x) for x in open(log)], self.completed(95493), self.completed(4711, "failed"),
                        # a poll's answer written just after its end never brings it back
                        self.out("c2", {"session_id": 95493, "output": "pending"})])
        jobs, ended = self.agents.background_jobs(log)
        self.assertEqual(jobs, {})
        self.assertGreater(ended, 0)

    def test_a_poll_of_a_process_codex_no_longer_knows_ends_it(self):
        """#1143: a batch polled two jobs read back already; Codex answered "Unknown process id" for one: it ended."""
        start = [self.call("c1", 'text(await tools.exec_command({cmd:"sleep 100"}));\ntext(await tools.exec_command({cmd:"npm test"}));\n'),
                 self.out("c1", {"session_id": 11, "output": ""}, {"session_id": 12, "output": ""})]
        self.assertEqual(sorted(self.agents.background_jobs(self.log(start))[0]), ["codex:11", "codex:12"])
        gone = {"type": "response_item", "payload": {"type": "custom_tool_call_output", "call_id": "c2", "output":
                [{"type": "input_text", "text": "Script failed\nError: Unknown process id 11"}]}}
        log = self.log([*start, self.call("c2", 'text(await tools.write_stdin({session_id:11,chars:""}));\n'), gone])
        self.assertEqual(sorted(self.agents.background_jobs(log)[0]), ["codex:12"])

    def test_ready_names_its_jobs_and_skips_codex_s_ended_ones(self):
        log = self.log([self.call("c1", 'text(await tools.exec_command({cmd:"python3 -m http.server 8000"}));\n'),
                        self.out("c1", {"session_id": 7, "output": ""})])
        task = {"id": 1, "agents": [{"address": "t1", "log": log}]}
        k = {"address": "t1", "foreground": {"pid": 100}}
        self.patch(self.agents, "agent_log", lambda t, a=None: log)
        self.patch(self.agents, "codex_working", lambda k: True)
        jobs, _ = self.agents.own_jobs(task, k)
        self.assertEqual(self.agents.job_names(log, list(jobs)), ["`python3 -m http.server 8000`"])
        self.patch(self.agents, "codex_working", lambda k: False)  # nothing of its own runs under it any more
        self.assertEqual(self.agents.own_jobs(task, k)[0], {})


class ExtraFlags(unittest.TestCase):
    """#1222: a task (and a space) carries extra launch flags for its agent's CLI, such as --advisor opus: only real
    Claude Code or Codex flags, none Shepherdr sets itself; kept one word each so launch, resume, switch and restart
    keep them whole. A real task list on disk, a throwaway git repo and settings file; nothing is started."""

    def setUp(self):
        import argparse
        import contextlib
        import io
        import shutil
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.commands as commands
        import herdr_task.flags as flags
        import herdr_task.settings as settings
        import herdr_task.store as store
        from herdr_task.base import Fail
        self.commands, self.flags, self.settings, self.store_mod, self.Fail = commands, flags, settings, store, Fail
        self.argparse, self.io, self.redirect = argparse, io, contextlib.redirect_stdout
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.folder = os.path.join(self.tmp, "app")
        os.makedirs(self.folder)
        subprocess.run(["git", "init", "-q", "-b", "main", self.folder], check=True)
        subprocess.run(["git", "-C", self.folder, "-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-q",
                        "--allow-empty", "-m", "base"], check=True)
        self.settings_file = os.path.join(self.tmp, "settings.json")
        # the installed CLIs' --help is never asked unless a test says so
        for p in (mock.patch.object(store, "STORE", os.path.join(self.tmp, "tasks")),
                  mock.patch.object(settings, "SETTINGS", self.settings_file),
                  mock.patch.object(commands, "caller_space", lambda: "sp1"),
                  mock.patch.object(commands, "default_space", lambda: "sp1"),
                  mock.patch.object(commands, "live_agents", lambda key: []),
                  mock.patch.dict(flags._help, {"claude": {}, "codex": {}}, clear=True)):
            p.start()
            self.addCleanup(p.stop)

    def run_cmd(self, fn, **kw):
        base = dict(folder=self.folder, json=True, id=None, title=None, prompt=None, prompt_file=None, here=False,
                    worktree=False, after=None, space=None, at=None, in_=None, agent=None, model=None, effort=None,
                    flags=None, argv=None, parent=None, now=False, base=None, start_notes=None, finish_notes=None, set=None)
        out = self.io.StringIO()
        with self.redirect(out):
            fn(self.argparse.Namespace(**{**base, **kw}))
        return json.loads(out.getvalue())

    def space_settings(self, **tasks):
        with open(self.settings_file, "w") as f:
            json.dump({"spaces": {"sp1": {"folder": self.folder, "tasks": tasks}}}, f)

    def with_task(self, n, fn):
        with self.store_mod.Store(self.store_mod.locate(self.folder), write=False) as s:
            return fn(s, s.find(n))

    def argv(self, n, agent=None):
        return self.with_task(n, lambda s, t: self.settings.worker_argv(s, t, "sp1", agent))

    def test_only_real_flags_none_of_shepherdrs_own(self):
        P = self.flags.parse
        self.assertEqual(P("claude", "--advisor opus"), ["--advisor=opus"])
        self.assertEqual(P("claude", ["-n", "my task", "--add-dir", "/a", "/b c", "--debug", "--verbose"]),
                         ["--name=my task", "--add-dir=/a", "--add-dir=/b c", "--debug", "--verbose"])
        self.assertEqual(P("codex", "-c model_verbosity=high -i a.png --search"),
                         ["--config=model_verbosity=high", "--image=a.png", "--search"])
        refused = {("claude", "--model opus"): "--model can't be an extra flag", ("claude", "--resume"): "resumes the task's own session",
                   ("claude", "-p"): "--print can't", ("claude", "--permission-mode plan"): "permission mode",
                   ("claude", "--settings {}"): "own --settings", ("claude", "--output-format json"): "only works with --print",
                   ("claude", "--worktree"): "its own worktree", ("claude", "--advisor"): "--advisor needs a value",
                   ("claude", "--verbose=1"): "takes no value", ("claude", "--no-such-flag"): "Claude Code has no --no-such-flag flag",
                   ("claude", "hello"): "isn't a flag", ("codex", "-m o3"): "--model can't", ("codex", "-c model_reasoning_effort=high"): "-c model_reasoning_effort",
                   ("codex", "--full-auto"): "sandbox and approvals", ("codex", "--advisor opus"): "Codex has no --advisor flag",
                   ("codex", "--no-daemon"): "passes it already", ("codex", "-C /x"): "task's folder"}
        for (agent, words), why in refused.items():
            with self.assertRaises(self.Fail, msg=words) as e:
                P(agent, words)
            self.assertIn(why, str(e.exception), words)

    def test_a_newer_cli_flag_from_its_own_help(self):
        """A flag newer than the tables passes when the installed CLI's --help lists it."""
        from unittest import mock
        bin_dir = os.path.join(self.tmp, "bin")
        os.makedirs(bin_dir)
        with open(os.path.join(bin_dir, "claude"), "w") as f:
            f.write("#!/bin/sh\ncat <<'X'\nOptions:\n  --brand-new <thing>      Something new\n  -z, --zap                Zap\nX\n")
        os.chmod(os.path.join(bin_dir, "claude"), 0o755)
        self.flags._help.pop("claude")
        with mock.patch.dict(os.environ, {"PATH": bin_dir + os.pathsep + os.environ["PATH"]}):
            self.assertEqual(self.flags.parse("claude", "--brand-new x --zap"), ["--brand-new=x", "--zap"])

    def test_task_flags_reach_the_agent_and_stay_through_resume(self):
        from herdr_task import launch, revive
        self.run_cmd(self.commands.cmd_add, title="Advised", model="sonnet", flags="--advisor opus")
        argv = self.argv(1)
        self.assertEqual(argv[:2], ["claude", "--advisor=opus"])
        self.assertIn("--model", argv)
        # resume (switch, a crash's recovery) keeps the one word, and the session id stays the session id
        self.assertEqual(launch.resume_argv(argv, "abc", self.folder)[-2:], ["--resume", "abc"])
        self.assertIn("--advisor=opus", launch.resume_argv(argv, "abc", self.folder))
        kind, base = revive.base_argv(argv + ["--resume", "abc", "the first message"])
        self.assertEqual(base, argv)
        # the brief's Settings block says them where model and effort show
        block = self.with_task(1, lambda s, t: self.settings.settings_block(s, t, "sp1"))
        self.assertIn("- Agent: claude, model sonnet, extra flags --advisor=opus (set by the assistant for this task)", block)

    def test_refused_on_add_and_edit_with_the_reason(self):
        with self.assertRaises(self.Fail) as e:
            self.run_cmd(self.commands.cmd_add, title="Bad", flags="--model opus")
        self.assertIn("use --model", str(e.exception))
        self.run_cmd(self.commands.cmd_add, title="Fine")
        with self.assertRaises(self.Fail):
            self.run_cmd(self.commands.cmd_edit, id="1", set=["flags=--print"])
        self.run_cmd(self.commands.cmd_edit, id="1", set=["flags=--advisor sonnet --verbose"])
        self.assertEqual(self.argv(1)[1:3], ["--advisor=sonnet", "--verbose"])
        self.run_cmd(self.commands.cmd_edit, id="1", set=["flags="])
        self.assertNotIn("--advisor=sonnet", self.argv(1))

    def test_a_space_default_per_cli_and_the_tasks_own_wins(self):
        self.space_settings(claude_flags=["--advisor=opus"], codex_flags=["--search"])
        self.run_cmd(self.commands.cmd_add, title="Plain")
        self.assertEqual(self.argv(1)[:2], ["claude", "--advisor=opus"])
        # the other CLI gets its own space default, never Claude Code's flags
        codex = self.argv(1, "codex")
        self.assertEqual(codex[:3], ["codex", "--no-daemon", "--search"])
        self.assertNotIn("--advisor=opus", codex)
        self.run_cmd(self.commands.cmd_edit, id="1", flags="--verbose")
        self.assertEqual(self.argv(1)[1:2], ["--verbose"])
        self.assertNotIn("--advisor=opus", self.argv(1))
        self.run_cmd(self.commands.cmd_edit, id="1", set=["flags=none"])
        self.assertEqual(self.argv(1)[1], "--settings")
        # a codex task checks its flags against Codex
        self.run_cmd(self.commands.cmd_add, title="Codex one", agent="codex", flags="--search")
        with self.assertRaises(self.Fail):
            self.run_cmd(self.commands.cmd_add, title="Wrong CLI", agent="codex", flags="--advisor opus")

    def test_a_bad_setting_never_breaks_the_launch(self):
        """A settings file edited by hand: what no longer passes is left out, the agent still starts."""
        self.space_settings(claude_flags=["--model=opus", "--advisor=opus", "a prompt"])
        self.run_cmd(self.commands.cmd_add, title="Plain")
        argv = self.argv(1)
        self.assertEqual(argv[:2], ["claude", "--advisor=opus"])
        self.assertEqual(argv.count("--model"), 0)
        self.assertNotIn("a prompt", argv)

    def test_edit_starts_the_next_agent_on_the_new_flags(self):
        self.run_cmd(self.commands.cmd_add, title="Plain")
        before = self.with_task(1, lambda s, t: t.get("pick_at"))
        self.run_cmd(self.commands.cmd_edit, id="1", flags="--verbose")
        self.assertTrue(self.with_task(1, lambda s, t: t.get("pick_at")) and self.with_task(1, lambda s, t: t.get("pick_at")) != before)

    def test_the_check_command(self):
        import argparse
        out = self.io.StringIO()
        with self.redirect(out):
            self.flags.cmd_flags(argparse.Namespace(agent="claude", json=True, words=["--", "--advisor opus"]))
        self.assertEqual(json.loads(out.getvalue())["flags"], ["--advisor=opus"])


class HeldWhileOnAQuestion(unittest.TestCase):
    """#1213: a Mark up note held for an agent on a question card (herdr-task _hold) waits while it stays blocked, then
    goes once, the notes in order. A throwaway held file; hc is never run."""

    def setUp(self):
        import shutil
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.news as news
        self.news = news
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.state = {"state": "live", "status": {"app": "claude", "state": "blocked"}, "labels": {}}
        self.sent = []
        for name, value in (("HELD", os.path.join(self.tmp, "held.json")), ("hc_json", lambda *a: self.state),
                            ("typing", lambda *a, **k: None),
                            ("plain_send", lambda to, text: self.sent.append((to, text)) or True)):
            p = mock.patch.object(news, name, value)
            p.start()
            self.addCleanup(p.stop)

    def test_held_until_answered_then_sent_once_in_order(self):
        self.news.hold("t7", "first note")
        self.news.hold("t7", "second note")
        self.news.held_pass({})
        self.assertEqual(self.sent, [], "never typed into its question")
        self.state["status"]["state"] = "idle"
        report = {}
        self.news.held_pass(report)
        self.assertEqual(self.sent, [("t7", "first note\n\nsecond note")])
        self.assertEqual(report["held"], [{"to": "t7", "messages": 2}])
        self.news.held_pass({})
        self.assertEqual(len(self.sent), 1)

    def test_the_cli_keeps_it(self):
        held = os.path.join(self.tmp, "store")
        r = subprocess.run([sys.executable, os.path.join(BIN, "herdr-task"), "_hold", "t7"], input="a note",
                           env={**os.environ, "HERDR_TASK_STORE": held}, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(os.path.join(held, ".held.json")) as f:
            self.assertEqual([x["text"] for x in json.load(f)["t7"]], ["a note"])


class WorktreeRemovalStopsItsServers(unittest.TestCase):
    """#1127: a done task's dev server still running in its worktree kept writing there, so the removal left part of
    the folder behind (git's record gone) and the server ran on. Now it is stopped first, the folder is really gone,
    a leftover is removed on a later try, and one that won't go is noted with why. A real repo and real processes."""

    def setUp(self):
        sys.path.insert(0, BIN)
        import herdr_task.github as github
        self.github = github
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(self.tmp, ignore_errors=True))
        self.main = os.path.join(self.tmp, "app")
        os.makedirs(self.main)
        g = lambda *a, cwd=self.main: subprocess.run(["git", "-C", cwd, "-c", "user.name=T", "-c", "user.email=t@example.com", *a],
                                                     check=True, capture_output=True)  # noqa: E731
        g("init", "-q", "-b", "main", cwd=self.main)
        g("commit", "-q", "--allow-empty", "-m", "start")
        self.wt = os.path.join(self.tmp, "wts", "app", "task-1")
        g("worktree", "add", "-q", "-b", "task/1", self.wt)

        class S:
            loc = {"folder": self.main}
            dirty = False
        self.s = S()
        self.task = {"id": 1, "worktree": self.wt, "branch": "task/1"}

    def server(self, ignore_term=False):
        """A stand-in dev server: started in the worktree, writing a file there every 20 ms."""
        code = ("import os,signal,time\n" + ("signal.signal(signal.SIGTERM, signal.SIG_IGN)\n" if ignore_term else "") +
                "os.makedirs('.next', exist_ok=True)\nprint(1, flush=True)\n"
                "while True:\n    open(os.path.join(os.getcwd(), '.next', 'dev.log'), 'a').write('x')\n    time.sleep(0.02)\n")
        p = subprocess.Popen([sys.executable, "-c", code], cwd=self.wt, stdout=subprocess.PIPE)
        self.addCleanup(lambda: (p.kill(), p.wait(), p.stdout.close()))
        p.stdout.readline()
        return p

    @unittest.skipUnless(os.path.isdir("/proc/self"), "reads /proc")
    def test_a_running_server_is_stopped_and_the_folder_is_gone(self):
        p = self.server()
        self.assertIn(p.pid, [pid for pid, _ in self.github.procs_in(self.wt)])
        self.assertTrue(self.github.remove_worktree(self.s, self.task))
        self.assertFalse(os.path.exists(self.wt))
        self.assertIsNotNone(p.wait(timeout=5))
        self.assertEqual(self.task["worktree_stopped"], [f"{os.path.basename(sys.executable)[:15]} (pid {p.pid})"])
        self.assertNotIn("task/1", subprocess.run(["git", "-C", self.main, "branch"], capture_output=True, text=True).stdout)

    @unittest.skipUnless(os.path.isdir("/proc/self"), "reads /proc")
    def test_one_that_ignores_term_is_killed(self):
        from unittest import mock
        p = self.server(ignore_term=True)
        with mock.patch.object(self.github, "STOP_WAIT", 0.5):
            self.assertTrue(self.github.remove_worktree(self.s, self.task))
        self.assertEqual(p.wait(timeout=5), -9)
        self.assertFalse(os.path.exists(self.wt))

    def test_a_leftover_folder_is_removed_on_a_later_try(self):
        """What the old removal left: git's record gone, files still there; git worktree remove can't take it."""
        subprocess.run(["git", "-C", self.main, "worktree", "remove", "--force", self.wt], check=True)
        os.makedirs(os.path.join(self.wt, ".next", "types"))
        open(os.path.join(self.wt, "next.config.js"), "w").close()
        self.assertTrue(self.github.removal_leftover(self.wt))
        self.assertTrue(self.github.remove_worktree(self.s, self.task))
        self.assertFalse(os.path.exists(self.wt))

    def test_a_folder_git_never_listed_is_not_ours(self):
        other = os.path.join(self.tmp, "wts", "app", "someone-elses")
        subprocess.run(["git", "init", "-q", other], check=True)
        self.task["worktree"] = other
        self.assertFalse(self.github.remove_worktree(self.s, self.task))
        self.assertTrue(os.path.isdir(other))

    def test_uncommitted_work_keeps_it(self):
        with open(os.path.join(self.wt, "tracked.txt"), "w") as f:
            f.write("x")
        subprocess.run(["git", "-C", self.wt, "add", "tracked.txt"], check=True)
        self.assertFalse(self.github.remove_worktree(self.s, self.task))
        self.assertTrue(os.path.isdir(self.wt))

    def test_one_that_wont_go_says_why(self):
        from unittest import mock
        with mock.patch.object(self.github.shutil, "rmtree", lambda *a, **k: None), \
                mock.patch.object(self.github, "procs_in", lambda folder, table=None: [(4242, "next-server")]), \
                mock.patch.object(self.github, "stop_in", lambda folder: []), \
                mock.patch.object(self.github, "git", lambda *a: (True, "", "")):
            self.assertFalse(self.github.remove_worktree(self.s, self.task))
        self.assertEqual(self.task["worktree_left"]["running"], ["next-server (pid 4242)"])
        self.assertTrue(self.task["worktree_removing"])

    def test_a_terminals_own_program_and_agents_are_never_stopped(self):
        wt = os.path.realpath(self.wt)
        table = [(10, 1, "herdr-core", "/"), (11, 10, "bash", wt), (12, 11, "claude", wt), (13, 12, "bash", wt),
                 (14, 13, "next-server", os.path.join(wt, "apps")), (15, 1, "node", "/elsewhere"), (16, 1, "codex", wt)]
        self.assertEqual(self.github.procs_in(self.wt, table), [(13, "bash"), (14, "next-server")])


class ReadyAndPrFlow(unittest.TestCase):
    """SHEP-283: ready and pull request fixes (#1207, #1208, #1087, #1155, #1194, #1204, #1116), in TaskFlow's throwaway
    repo and store; hc and gh are never run."""
    setUp, patch, git, commit, args = TaskFlow.setUp, TaskFlow.patch, TaskFlow.git, TaskFlow.commit, TaskFlow.args
    patch_new, remote = ReadyMergeGit.patch_new, ReadyMergeGit.remote

    # ---- #1207: an agent's own suggested next message in its input is nobody typing ----------------------------
    def typing_with(self, screen, lines):
        import herdr_task.news as news
        log = os.path.join(self.root, "log.jsonl")
        with open(log, "w") as f:
            for d in lines:
                f.write(json.dumps(d) + "\n")
        self.patch(news, "screen_raw", lambda address, there=None: screen)
        k = {"state": "live", "labels": {"herdr.resume": json.dumps({"kind": "claude", "log": log})}}
        return news.typing("t9", k)

    REPLY = {"type": "assistant", "message": {"content": [{"type": "text", "text": "Out of rounds, waiting.\n\n"
                                                           "<hc suggest=\"added a round, go ahead\"/>"}]}}

    def test_a_suggested_reply_in_the_input_is_not_typing(self):
        self.assertIsNone(self.typing_with("❯ added a round, go ahead\n", [self.REPLY]))

    def test_any_of_three_suggested_replies_in_the_input_is_not_typing(self):
        three = {"type": "assistant", "message": {"content": [{"type": "text", "text": "Merge it?\n\n<hc suggest=\"Yes, merge it\"/>\n"
                                                           "<hc suggest=\"Show me the diff\"/>\n<hc suggest=\"status?\"/>"}]}}
        self.assertIsNone(self.typing_with("❯ Show me the diff\n", [three]))
        self.assertIsNone(self.typing_with("❯ status?\n", [three]))
        self.assertEqual(self.typing_with("❯ no\n", [three]), "input")

    def test_other_words_in_the_input_are_typing(self):
        self.assertEqual(self.typing_with("❯ wait, one more thing\n", [self.REPLY]), "input")

    def test_a_suggestion_older_than_the_persons_last_message_counts_for_nothing(self):
        person = {"type": "user", "message": {"role": "user", "content": "ok"}}
        self.assertEqual(self.typing_with("❯ added a round, go ahead\n", [self.REPLY, person]), "input")

    def test_review_more_says_held_never_told_when_its_message_waits(self):
        import herdr_task.news as news
        self.task["reviews"] = [{"round": 1, "result": "report", "at": 2, "head": "abc"}]
        self.patch(self.commands, "caller_labels", lambda: {})
        self.patch(self.commands, "review_limits", lambda s, t: (True, 1))
        self.patch(self.commands, "workers", lambda s, t: [{"address": "t9"}])
        for r, word in (("held", "held"), ("sent", "told t9"), (None, "couldn't send it")):
            self.patch(news, "send_or_hold", lambda address, text, how="send", r=r: r)
            self.said.clear()
            self.commands.cmd_review_more(self.args())
            self.assertIn(word, self.said[-1])
            if r == "held":
                self.assertNotIn("told", self.said[-1])

    # ---- #1208, #1087, #1155: the pull request's title, description and draft ------------------------------------
    def gh_with(self, body):
        import herdr_task.github as github
        asked = []

        def gh(*a, **k):
            asked.append(a)
            if a[:2] == ("pr", "view") and "body" in a:
                return True, body[0], ""
            if a[:2] == ("pr", "create"):
                return True, "https://github.com/o/r/pull/9", ""
            return (True, "OPEN", "") if a[:2] == ("pr", "view") else (True, "[]", "")
        self.patch(github, "gh", gh)
        return github, asked

    def test_a_second_ready_keeps_what_was_added_around_its_own_part(self):
        self.remote()
        self.commit(self.task["worktree"], "work", "a.txt")
        github, asked = self.gh_with([""])
        github.pr_open(self.store, self.task, "o/r", "First")
        create = next(a for a in asked if a[:2] == ("pr", "create"))
        first = create[create.index("--body") + 1]
        self.assertTrue(first.startswith(github.MARK_START) and first.endswith(github.MARK_END))
        handed = first + "\n\n## Hand-off\n\nDeploy after the migration."
        github, asked = self.gh_with([handed])
        self.task["details"] = "- The second round's fix"
        github.pr_open(self.store, self.task, "o/r", "Second")
        edit = [a for a in asked if a[:2] == ("pr", "edit")]
        self.assertEqual(len(edit), 1)
        new = edit[0][edit[0].index("--body") + 1]
        self.assertIn("Second", new)
        self.assertIn("- The second round's fix", new)
        self.assertIn("## Hand-off\n\nDeploy after the migration.", new)
        self.assertNotIn("First", new)

    def test_an_older_unmarked_description_with_a_hand_added_section_is_left_alone(self):
        self.remote()
        self.commit(self.task["worktree"], "work", "a.txt")
        self.task.update(pr={"number": 7, "url": "u", "repo": "o/r"})
        github, asked = self.gh_with([f"Task: {self.store.ref(self.task)}\n\n## Summary\n\nOld\n\n## Hand-off\n\nMine"])
        github.pr_open(self.store, self.task, "o/r", "New")
        self.assertEqual([a for a in asked if a[:2] == ("pr", "edit")], [])

    def test_ready_opens_with_the_agents_own_title_body_and_as_a_draft(self):
        import argparse
        self.remote()
        self.commit(self.task["worktree"], "work", "a.txt")
        self.commands.pr_words(self.task, argparse.Namespace(pr_title="fix(api): retry  timeouts", pr_body="Short body.",
                                                             draft=True))
        github, asked = self.gh_with([""])
        github.pr_open(self.store, self.task, "o/r", "Done")
        create = next(a for a in asked if a[:2] == ("pr", "create"))
        self.assertEqual(create[create.index("--title") + 1], "fix(api): retry timeouts")
        self.assertEqual(create[create.index("--body") + 1], "Short body.")
        self.assertIn("--draft", create)
        # a later ready that gives a new title and body changes the open pull request's, once
        self.commands.pr_words(self.task, argparse.Namespace(pr_title="fix(api): retry", pr_body="Shorter.", draft=False))
        github, asked = self.gh_with(["Short body."])
        github.pr_open(self.store, self.task, "o/r", "Done")
        edits = [a for a in asked if a[:2] == ("pr", "edit")]
        self.assertIn(("pr", "edit", "9", "--repo", "o/r", "--title", "fix(api): retry"), edits)
        self.assertIn(("pr", "edit", "9", "--repo", "o/r", "--body", "Shorter."), edits)
        github, asked = self.gh_with(["Shorter."])
        github.pr_open(self.store, self.task, "o/r", "Done again")
        self.assertEqual([a for a in asked if a[:2] == ("pr", "edit")], [])  # its own words stay

    def test_accept_takes_a_draft_out_of_draft_before_merging(self):
        self.task.update(state="ready", pr={"number": 9, "url": "u", "repo": "o/r"}, pr_draft=True)
        views = [{"state": "OPEN", "mergeable": "MERGEABLE", "mergeStateStatus": "DRAFT", "statusCheckRollup": [],
                  "headRefOid": "abc"}, {"state": "MERGED", "mergeCommit": {"oid": "f00"}}]
        asked = []
        for name, value in (("pr_view", lambda t: views.pop(0)), ("gh", lambda *a, **k: (asked.append(a[:2]), (True, "", ""))[1]),
                            ("watch_main", lambda *a: None), ("update_main", lambda *a: None),
                            ("drop_branch", lambda s, t: None), ("finish", lambda s, t, even_if_busy=False: t.update(state="done")),
                            ("checks_missing", lambda *a: None), ("expected_checks", lambda *a: None),
                            ("note_checks", lambda *a: None)):
            self.patch(self.commands, name, value)
        self.assertIsNone(self.commands.merge_now(self.store, self.task))
        self.assertEqual(asked, [("pr", "ready"), ("pr", "merge")])

    # ---- #1194: ready works on the task's branch ---------------------------------------------------------------
    def test_ready_refuses_another_branch_checked_out(self):
        from herdr_task.base import Fail
        wt = self.task["worktree"]
        self.commit(wt, "part 1", "a.txt")
        self.commands.on_branch(self.task, wt)  # on its own branch: fine
        self.git(wt, "switch", "-q", "-c", "part-2")
        self.commit(wt, "part 2", "b.txt")
        with self.assertRaises(Fail) as e:
            self.commands.on_branch(self.task, wt)
        self.assertIn("part-2", str(e.exception))
        self.assertIn("task/1", str(e.exception))
        self.git(wt, "switch", "-q", "--detach", "task/1")
        self.commands.on_branch(self.task, wt)  # detached at its own tip: fine
        self.git(wt, "switch", "-q", "--detach", "part-2")
        with self.assertRaises(Fail):
            self.commands.on_branch(self.task, wt)

    # ---- #1204: a task started on an open pull request's branch goes on that pull request --------------------
    def base_pr_with(self, prs, **task):
        self.task.update(task)
        self.patch(self.commands, "github", lambda s: "o/r")
        self.patch(self.commands, "gh", lambda *a, **k: (True, json.dumps(prs), "") if a[:2] == ("pr", "list") else (True, "", ""))
        self.commands.base_pr(self.store, self.task)
        return self.task.get("pr")

    PR = {"number": 41, "url": "https://github.com/o/r/pull/41", "isCrossRepository": False, "headRefName": "feature",
          "baseRefName": "main", "headRefOid": "abc", "state": "OPEN"}

    def test_ready_takes_the_pull_request_open_from_its_base_branch(self):
        pr = self.base_pr_with([self.PR], base="feature", base_set=True)
        self.assertEqual((pr["number"], pr["branch"], pr["taken"], pr["from_base"]), (41, "feature", True, True))

    def test_a_space_base_branch_or_a_task_with_a_pull_request_takes_none(self):
        self.assertIsNone(self.base_pr_with([self.PR], base="feature", base_set=True, base_by="space"))
        self.task.pop("base_by")
        mine = {"number": 5, "url": "u", "repo": "o/r"}
        self.assertEqual(self.base_pr_with([self.PR], base="feature", base_set=True, pr=mine), mine)
        self.task.pop("pr")
        self.assertIsNone(self.base_pr_with([dict(self.PR, isCrossRepository=True)], base="feature", base_set=True))
        self.assertIsNone(self.base_pr_with([self.PR], base="main"))  # no base of its own

    def test_on_its_base_branchs_pull_request_it_is_never_nothing_to_merge(self):
        """#1204: its work already pushed to the pull request's branch (its base): ready keeps it on that pull request,
        never Ready with nothing to merge, nor done because its base holds it."""
        import argparse
        wt = self.task["worktree"]
        self.git(self.main, "branch", "feature", "main")
        self.task.update(base="feature", base_set=True, start=self.git(wt, "rev-parse", "HEAD"))
        self.patch(self.commands, "github", lambda s: "o/r")
        self.patch(self.commands, "gh", lambda *a, **k: (True, json.dumps([self.PR]), "") if a[:2] == ("pr", "list") else (True, "", ""))
        for name in ("review_refusal", "find_proof", "own_work"):
            self.patch(self.commands, name, lambda *a, **k: None)
        self.patch(self.commands, "ready_turns", lambda live: {})
        self.patch(self.commands, "task_settings", lambda s, t: [])
        finalized = []
        self.patch(self.commands, "finalize", lambda s, t: (finalized.append(dict(t)), "ready")[1])
        self.patch(self.commands, "already_merged", lambda s, t: self.fail("asked whether it merged"))
        self.commands.cmd_ready(argparse.Namespace(id="SHEP-1", json=True, folder=None, summary="Done.", details=None,
                                                   proof=None, agents_md=None, pr=None, pr_title=None, pr_body=None,
                                                   draft=False))
        self.assertEqual(finalized[0]["pr"]["number"], 41)
        self.assertNotIn("nothing_to_merge", finalized[0])

    # ---- #1116: a later round reviews what changed since the last one -------------------------------------------
    def test_the_refusal_names_what_changed_since_the_last_reviewed_commit(self):
        wt = self.task["worktree"]
        first = self.commit(wt, "work", "a.txt")
        self.task.update(review_gate=True, reviews=[{"round": 1, "result": "report", "at": 2, "head": first, "text": "1 major"}])
        self.task["head"] = self.commit(wt, "fix", "a.txt")
        self.patch(self.commands, "review_limits", lambda s, t: (True, 3))
        said = self.commands.review_refusal(self.store, self.task, wt)
        self.assertIn(f"git diff {first[:7]}..HEAD", said)


class MergedWhileWaiting(unittest.TestCase):
    """#1124: a task that said ready closes once its pull request merged, whatever its agent waits on; #1106: a closed
    pull request lets Accept close the task without merging."""
    setUp, queue_tick, pr_task, ready, merging = (BackToWork.setUp, BackToWork.queue_tick, BackToWork.pr_task,
                                                  BackToWork.ready, BackToWork.merging)

    def args(self, **kw):
        import argparse
        return argparse.Namespace(id="SHEP-7", json=True, folder=None, **kw)

    MERGED = {"state": "MERGED", "mergeCommit": {"oid": "f00"}}

    def test_merged_after_ready_closes_under_an_idle_or_asking_agent(self):
        for status in ("idle", "blocked"):
            t = self.pr_task(state="running")
            self.live = [{"address": "t1", "status": {"state": status}, "agent": "claude"}]
            got, _ = self.queue_tick(self.MERGED)
            self.assertEqual((t["state"], t.get("merged")), ("done", True), status)

    def test_merged_after_ready_waits_for_an_agent_still_working(self):
        t = self.pr_task(state="running")
        self.live = [{"address": "t1", "status": {"state": "working"}, "agent": "claude"}]
        self.queue_tick(self.MERGED)
        self.assertEqual(t["state"], "running")

    def test_a_reopened_task_stays_open(self):
        t = self.pr_task(state="running", kept_open=True)
        self.queue_tick(self.MERGED)
        self.assertEqual(t["state"], "running")

    def test_a_closed_pull_request_shows_accept_without_merging_and_accept_closes_the_task(self):
        t = self.pr_task()
        _, report = self.queue_tick({"state": "CLOSED", "statusCheckRollup": []})
        self.assertTrue(t["pr"]["closed"])
        self.assertIn("Accept closes the task without merging", t["attention"])
        done = self.merging([{"state": "CLOSED", "statusCheckRollup": []}], [])
        self.commands.cmd_accept(self.args())
        self.assertEqual((t["state"], t.get("closed_unmerged"), t.get("merged")), ("done", True, None))
        self.assertEqual(done, [7])

    def test_only_accept_closes_it_unmerged(self):
        t = self.pr_task()
        self.merging([{"state": "CLOSED", "statusCheckRollup": []}], [])
        self.assertIn("was closed", self.commands.merge_now(self.store, t))
        self.assertEqual(t["state"], "ready")


# ---- Shepherdr 3.2 (SHEP-292): its own herdr-core session, Stopped, Stop, schedules, the new task commands ----

class OwnSession(unittest.TestCase):
    """3.2: Shepherdr's agents, tasks and scheduler live in a herdr-core session of their own (HC_SESSION), never the
    default one the Herdr app shows. Every hc herdr-task runs is in it; any other session (a test's) is refused."""

    SNIPPET = ("import json, os, sys; sys.dont_write_bytecode = True; sys.path.insert(0, sys.argv[1]);"
               "from herdr_task import base; base.real_home = lambda: os.environ['HOME'];"
               "out = {'session': base.SESSION, 'hc': os.environ.get('HC_SESSION'), 'id': os.environ.get('HC_TERMINAL_ID'),"
               " 'foreign': base.FOREIGN_TERMINAL, 'why': base.not_real()};\n"
               "try:\n base.guard(['hc', 'ls']); out['guard'] = None\n"
               "except base.Fail as e:\n out['guard'] = str(e)\n"
               "print(json.dumps(out))")

    def base(self, **more):
        env = {k: v for k, v in os.environ.items() if not k.startswith(("HC_", "SHEPHERDR_SESSION"))}
        r = subprocess.run([sys.executable, "-c", self.SNIPPET, BIN], env={**env, **more}, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    def test_a_plain_shell_lands_in_shepherdrs_session(self):
        got = self.base()
        self.assertEqual((got["session"], got["hc"], got["why"], got["guard"]), ("shepherdr", "shepherdr", None, None))

    def test_the_herdr_apps_terminal_is_nobody_here(self):
        """Called from a terminal of the default session: the calls go to Shepherdr's, and that terminal's id is dropped
        (it would name another session's terminal as the caller)."""
        got = self.base(HC_SESSION="default", HC_TERMINAL_SOCKET="/run/user/1/herdr-core/default.sock", HC_TERMINAL_ID="t5")
        self.assertEqual((got["hc"], got["id"], got["foreign"], got["guard"]), ("shepherdr", None, True, None))
        got = self.base(HC_TERMINAL_SOCKET="/run/user/1/herdr-core/default.sock", HC_TERMINAL_ID="t5")  # hc sets no HC_SESSION there
        self.assertEqual((got["hc"], got["id"], got["foreign"]), ("shepherdr", None, True))

    def test_an_agent_inside_stays_itself(self):
        got = self.base(HC_SESSION="shepherdr", HC_TERMINAL_SOCKET="/run/user/1/herdr-core/shepherdr.sock", HC_TERMINAL_ID="t5")
        self.assertEqual((got["hc"], got["id"], got["foreign"], got["guard"]), ("shepherdr", "t5", False, None))

    def test_any_other_session_is_refused(self):
        got = self.base(HC_SESSION="shep292-test-9", HC_TERMINAL_ID="t5")
        self.assertEqual((got["hc"], got["id"]), ("shep292-test-9", "t5"))  # left as it was
        self.assertIn("HC_SESSION is shep292-test-9, not Shepherdr's own (shepherdr)", got["why"])
        self.assertIn("refusing to run hc", got["guard"])
        got = self.base(HC_SOCKET="/tmp/x/other.sock")
        self.assertIn("HC_SOCKET is /tmp/x/other.sock", got["guard"])

    def test_a_tests_own_session_by_name(self):
        got = self.base(SHEPHERDR_SESSION="shep292-test-9")
        self.assertEqual((got["session"], got["hc"], got["guard"]), ("shep292-test-9", "shep292-test-9", None))
        got = self.base(SHEPHERDR_SESSION="shep292-test-9", HC_SESSION="shep292-test-9")
        self.assertIsNone(got["guard"])
        got = self.base(SHEPHERDR_SESSION="shep292-test-9", HC_SESSION="shepherdr")
        self.assertIn("refusing to run hc", got["guard"])

    def test_the_scheduler_and_every_hc_call_are_in_it(self):
        """A real herdr-task run with a fake hc that notes its session: the scheduler it keeps is started in Shepherdr's."""
        tmp = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp, ignore_errors=True))
        store, folder, fakebin, log = (os.path.join(tmp, n) for n in ("store", "app", "bin", "hc.log"))
        for d in (store, folder, fakebin):
            os.makedirs(d)
        with open(os.path.join(store, "app.json"), "w") as f:
            json.dump({"version": 1, "folder": folder, "kind": "folder", "name": "app", "slug": "app", "prefix": "APP", "next": 2,
                       "tasks": [{"id": 1, "title": "x", "state": "queued", "mode": "here", "agents": [], "created": 1}]}, f)
        with open(os.path.join(fakebin, "hc"), "w") as f:
            f.write('#!/bin/sh\necho "${HC_SESSION-unset}|${HC_TERMINAL_ID-none}|$*" >> "%s"\ncase "$1" in run) echo \'{"address":"t1"}\' ;; *) exit 3 ;; esac\n' % log)
        os.chmod(os.path.join(fakebin, "hc"), 0o755)
        b = ("import sys, runpy; sys.dont_write_bytecode = True; sys.path.insert(0, sys.argv[1]);"
             "import herdr_task.base as base; base.not_real = lambda: None;"
             "sys.argv = sys.argv[2:]; runpy.run_path(sys.argv[0], run_name='__main__')")
        env = {**{k: v for k, v in os.environ.items() if not k.startswith("HC_")}, "HERDR_TASK_STORE": store,
               "PATH": fakebin + os.pathsep + "/usr/bin:/bin", "HC_TERMINAL_SOCKET": "/run/user/1/herdr-core/default.sock", "HC_TERMINAL_ID": "t77"}
        r = subprocess.run([sys.executable, "-c", b, BIN, os.path.join(BIN, "herdr-task"), "scheduler", "--ensure", "--json"],
                           capture_output=True, text=True, env=env, cwd=folder)
        self.assertEqual(json.loads(r.stdout)["started"], True, r.stderr)
        with open(log) as f:
            calls = [ln.rstrip("\n").split("|", 2) for ln in f]
        self.assertTrue(calls and all(c[0] == "shepherdr" and c[1] == "none" for c in calls), calls)
        self.assertTrue(any(c[2].startswith("run --bg --json --keep --no-parent --no-notify --name herdr-automations") for c in calls), calls)

    def test_a_scheduler_left_in_the_default_session_makes_way(self):
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.automations as au
        import herdr_task.base as base
        asked = []
        with mock.patch.object(base, "FOREIGN_TERMINAL", True), \
                mock.patch.object(au, "ensure_scheduler", lambda quiet=False: (asked.append(1), {"running": True, "started": True, "note": "Started the scheduler."})[1]):
            import argparse, contextlib, io
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                au.cmd_scheduler(argparse.Namespace(ensure=False, once=False, json=False))
        self.assertEqual(asked, [1])
        self.assertIn("outside Shepherdr's own herdr-core session (shepherdr)", out.getvalue())

    def test_a_link_to_another_session_there_is_refused(self):
        """--on <machine>: its link must lead to Shepherdr's own session there (hc machine add --session shepherdr)."""
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.cli as cli
        ran = []

        def run(args, **kw):
            ran.append(args)
            out = json.dumps({"machines": [{"name": "vm", "target": "vm.example", "session": self.there}]}) if args[:3] == ["hc", "machine", "ls"] else ""
            return subprocess.CompletedProcess(args, 0 if args[:3] == ["hc", "machine", "ls"] or "herdr-task" in " ".join(args) else 1, out, "")
        store = tempfile.mkdtemp()
        with mock.patch.object(cli, "run", run), mock.patch.object(cli, "STORE", store), mock.patch.object(cli, "sync_held", lambda: None), \
                mock.patch.object(cli, "guard", lambda a: None), mock.patch.object(cli, "install_secret", lambda m: None), \
                mock.patch.object(cli.subprocess, "run", lambda argv, **kw: subprocess.CompletedProcess(argv, 0, b"", b"")):
            self.there = None  # added without --session: the default session there
            with self.assertRaises(cli.Fail) as e:
                cli.remote_run("vm", ["list", "--json"])
            self.assertIn("hc machine add vm.example --name vm --session shepherdr", str(e.exception))
            self.there = "shepherdr"
            cli.remote_run("vm", ["list", "--json"])
            self.assertEqual(ran[-1][:4], ["hc", "exec", "--on", "vm"])

    def test_adopt_adds_the_default_sessions_machines(self):
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.machines as machines
        state = tempfile.mkdtemp()
        os.makedirs(os.path.join(state, "herdr-core", "default"))
        with open(os.path.join(state, "herdr-core", "default", "machines.json"), "w") as f:
            json.dump([{"name": "mini", "target": "mini.example"}, {"name": "box", "target": "fly ssh console -a x -C", "via": True},
                       {"name": "old", "target": "old.example"}, {"name": "tmp", "target": "t.example", "temporary": True}], f)
        ran = []
        with mock.patch.dict(os.environ, {"XDG_STATE_HOME": state}), \
                mock.patch.object(machines, "hc_json", lambda *a: {"machines": [{"name": "old", "session": None}]}), \
                mock.patch.object(machines, "run", lambda args, **k: (ran.append(args), subprocess.CompletedProcess(args, 0, "{}", ""))[1]):
            self.assertEqual([x["state"] for x in machines.adopt(dry=True)], ["would-add", "would-add", "wrong-session"])
            self.assertEqual(ran, [])
            got = machines.adopt()
        self.assertEqual([(x["name"], x["state"]) for x in got], [("mini", "added"), ("box", "added"), ("old", "wrong-session")])
        self.assertEqual(ran, [["hc", "machine", "add", "mini.example", "--name", "mini", "--session", "shepherdr", "--json"],
                               ["hc", "machine", "add", "--via", "fly ssh console -a x -C", "--name", "box", "--session", "shepherdr", "--json"]])


class Next32(unittest.TestCase):
    """3.2's task engine on Scheduled's real store (a throwaway folder and task list, agents and hc faked)."""
    run_cmd, tick_at, task = Scheduled.run_cmd, Scheduled.tick_at, Scheduled.task

    def add(self, title, **kw):
        # in the folder itself: no real worktree is made for a faked start
        return Scheduled.add(self, title, **({"here": True, **kw} if not kw.get("worktree") else kw))

    def setUp(self):
        Scheduled.setUp(self)
        from unittest import mock
        import herdr_task.agents as agents
        import herdr_task.output as output
        self.mock, self.agents = mock, agents
        self.live, self.hc = [], []

        def run(args, **kw):
            self.hc.append(list(args))
            out = json.dumps({"key": "esc", "outcome": "stopped"}) if args[:2] == ["hc", "interrupt"] else ""
            return subprocess.CompletedProcess(args, 0, out, "")
        for mod, name, value in ((self.commands, "live_agents", lambda key: list(self.live)), (self.commands, "detail", lambda k: k),
                                 (self.commands, "run", run), (agents, "held_ask", lambda a: None), (agents, "trust_asked", lambda live: None),
                                 (output, "subagents", lambda key: []), (self.commands, "refresh_sessions", lambda *a, **k: None),
                                 (self.commands, "task_tabs", lambda s, t: []), (agents, "own_work", lambda *a, **k: False)):
            p = mock.patch.object(mod, name, value)
            p.start()
            self.addCleanup(p.stop)

    def agent(self, status="working", turn=3, address="t9", **more):
        k = {"address": address, "state": "live", "agent": "claude", "foreground": {"name": "claude", "pid": 7}, "turn": turn,
             "status": {"state": status}, "status_ms": 1, "labels": {"herdr.task": "x"}, **more}
        self.live[:] = [k]
        return k

    def begun(self, title="Fix login", **kw):
        self.add(title, **kw)
        self.run_cmd(self.commands.cmd_start, id="1", now=True)
        with self.store_mod.Store(self.store_mod.locate(self.folder)) as s:
            s.find(1)["agents"] = [{"address": "t9", "agent": "claude", "argv": ["claude"], "at": 1, "session": "S1"}]
            s.dirty = True

    def change(self, n=1, **fields):
        with self.store_mod.Store(self.store_mod.locate(self.folder)) as s:
            s.find(n).update(fields)
            s.dirty = True

    def listed(self):
        return {v["id"]: v for v in self.run_cmd(self.commands.cmd_list, all=False, archived=False)["tasks"]}

    # ---- Stop is a pause (step 39) ----

    def test_stop_pauses_and_the_next_message_carries_on(self):
        self.begun()
        self.agent("working", turn=3)
        v = self.run_cmd(self.commands.cmd_stop, id="1")
        self.assertEqual(self.hc, [["hc", "interrupt", "t9", "--json"]])  # like pressing Esc: nothing killed, nothing removed
        self.assertEqual((v["state"], v["stopped"]), ("running", [{"address": "t9", "ok": True, "outcome": "stopped"}]))
        t = self.task(1)
        self.assertEqual((t["stopped_by"], t["stopped_why"], t["stopped_turns"]), ("you", "Stopped by you.", {"t9": 3}))
        self.agent("idle", turn=4)  # its interrupted turn ended
        self.change(stopped_turns={"t9": 4})
        v = self.listed()[1]
        self.assertEqual((v["status"], v["needs"], v["stopped_by"], v["stopped_why"]), ("needs", "stopped", "you", "Stopped by you."))
        v = self.run_cmd(self.commands.cmd_show, id="1")
        self.assertEqual((v["status"], v["stopped_by"]), ("needs", "you"))
        # their next message (sent straight to its agent, as the app does): it is at work again, no longer stopped
        self.agent("working", turn=4)
        v = self.listed()[1]
        self.assertEqual((v["status"], v.get("stopped_by")), ("working", None))
        import herdr_task.tick as tick
        report = {}
        with self.mock.patch.object(tick, "live_agents", lambda key: list(self.live)), self.mock.patch.object(tick, "detail", lambda k: k), \
                self.mock.patch.object(tick, "store_files", lambda *a: self.store_mod.store_files()), \
                self.mock.patch.object(tick, "now", lambda: self.task(1)["stopped_at"] + 60000):
            tick.stopped_pass(report)
        self.assertNotIn("stopped_by", self.task(1))

    def test_a_quick_turn_between_looks_still_clears_it(self):
        self.begun()
        self.agent("idle", turn=4)
        self.change(stopped_by="you", stopped_why="Stopped by you.", stopped_at=1, stopped_turns={"t9": 4})
        self.assertEqual(self.listed()[1]["stopped_by"], "you")
        self.agent("idle", turn=5)  # answered their message and went quiet again before anything looked
        v = self.listed()[1]
        self.assertNotIn("stopped_by", v)
        self.assertEqual(v["needs"], "reply")

    def test_stop_refuses_what_isnt_running(self):
        self.add("Later")
        with self.assertRaises(self.Fail) as e:
            self.run_cmd(self.commands.cmd_stop, id="1")
        self.assertIn("nothing to stop", str(e.exception))
        self.begun()
        self.live[:] = []
        with self.assertRaises(self.Fail) as e:
            self.run_cmd(self.commands.cmd_stop, id="1")
        self.assertIn("no agent at work", str(e.exception))
        self.assertEqual(self.hc, [])

    # ---- Stopped, never restarted (step 38) ----

    def stopped_pass(self, log_rows=None):
        import herdr_task.tick as tick
        log = os.path.join(self.tmp, "S1.jsonl")
        with open(log, "w") as f:
            f.write("".join(json.dumps(r) + "\n" for r in log_rows or []))
        report = {}
        with self.mock.patch.object(tick, "live_agents", lambda key: list(self.live)), self.mock.patch.object(tick, "detail", lambda k: k), \
                self.mock.patch.object(tick, "store_files", lambda *a: self.store_mod.store_files()), \
                self.mock.patch.object(tick, "agent_log", lambda t, address=None: log), \
                self.mock.patch.object(tick, "held_ask", lambda a: None), self.mock.patch.object(tick, "starting", lambda t: False):
            tick.stopped_pass(report)
        return report

    def cut(self, text, status=0, code=""):
        return [{"type": "user", "message": {"role": "user", "content": "go on"}, "timestamp": "2026-11-22T10:00:00Z"},
                {"type": "assistant", "isApiErrorMessage": True, "uuid": "u1", "timestamp": "2026-11-22T10:01:00Z", "error": code,
                 "apiErrorStatus": status, "message": {"content": [{"type": "text", "text": text}]}}]

    def test_a_crashed_agent_stops_its_task(self):
        self.begun()
        self.live[:] = []  # its terminal is gone
        self.assertEqual(self.stopped_pass()["stopped"], [{"task": "APP-1", "by": "error", "why": "Its agent is no longer running."}])
        t = self.task(1)
        self.assertEqual((t["stopped_by"], t["stopped_why"]), ("error", "Its agent is no longer running."))
        v = self.listed()[1]
        self.assertEqual((v["status"], v["needs"], v["stopped_by"], v["stopped_why"]), ("needs", "stopped", "error", "Its agent is no longer running."))
        self.assertEqual(self.hc, [])  # nothing typed, sent or started
        # a shell left where the agent ran (a reboot) is no agent either
        self.agent("idle", foreground={"name": "bash", "pid": 3, "argv": ["/bin/bash"]}, agent="bash")
        self.assertEqual(self.listed()[1]["stopped_by"], "error")

    def test_a_task_is_stopped_without_a_tick_too(self):
        """Every list says so at once, also before any pass stored it."""
        self.begun()
        self.change(agents=[{"address": "t9", "agent": "claude", "at": 1, "ended": 2}], started=1)
        self.live[:] = []
        with self.mock.patch.object(self.agents, "starting", lambda t: False):
            v = self.listed()[1]
        self.assertEqual((v["needs"], v["stopped_by"], v["stopped_why"], v["why"]), ("stopped", "error", "Its agent is no longer running.", "Agent stopped"))

    def test_a_cut_turn_is_never_retried(self):
        self.begun()
        self.agent("idle")
        report = self.stopped_pass(self.cut("API Error: 529 Overloaded", status=529))
        self.assertEqual(report["stopped"][0]["by"], "error")
        t = self.task(1)
        self.assertEqual(t["stopped_by"], "error")
        self.assertTrue(t["stopped_why"].startswith("Provider overloaded"), t["stopped_why"])
        self.assertNotIn("retry", t)
        self.assertEqual(self.hc, [])  # no "carry on" sent
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "tasks", ".retries.json")))
        self.assertEqual(self.listed()[1]["status"], "needs")

    def test_a_plans_limit_is_a_limit(self):
        self.begun()
        self.agent("idle")
        self.stopped_pass(self.cut("You've hit your usage limit · resets 3pm"))
        t = self.task(1)
        self.assertEqual(t["stopped_by"], "limit")
        self.assertTrue(t["stopped_why"].startswith("Out of allowance until 3pm"), t["stopped_why"])
        # still stopped while it sits there; at work again (a message got through): cleared
        self.assertEqual(self.stopped_pass(self.cut("You've hit your usage limit · resets 3pm"))["stopped"], [])
        self.agent("working")
        self.stopped_pass(self.cut("You've hit your usage limit · resets 3pm"))
        self.assertNotIn("stopped_by", self.task(1))

    def test_an_agent_that_reports_an_error(self):
        self.begun()
        self.agent("idle")["status"] = {"state": "error", "msg": "Tool crashed"}
        v = self.listed()[1]
        self.assertEqual((v["needs"], v["stopped_by"], v["stopped_why"]), ("stopped", "error", "Tool crashed"))

    def test_an_older_versions_retry_is_dropped(self):
        self.begun()
        self.agent("working")
        self.change(retry={"address": "t9", "reason": "Provider overloaded", "tries": 2, "due": 5})
        self.stopped_pass()
        self.assertNotIn("retry", self.task(1))
        self.assertEqual(self.listed()[1]["status"], "working")

    def test_resume_is_the_restart_button(self):
        self.begun()
        self.live[:] = []
        self.change(stopped_by="error", stopped_why="Its agent is no longer running.", stopped_at=1)
        got = {}
        with self.mock.patch.object(self.commands, "launch", lambda s, t, argv, space, msg=None, parent=None, resume=None, **k: (
                got.update(resume=resume, msg=msg), t["agents"].append({"address": "t10", "agent": "claude", "argv": argv, "at": 2}), t["agents"][-1])[2]), \
                self.mock.patch.object(self.commands, "resume_argv", lambda argv, session, folder: [*argv, "--resume", session]), \
                self.mock.patch.object(self.commands, "parent_for", lambda p, sp: None):
            v = self.run_cmd(self.commands.cmd_resume, id="1")
        self.assertEqual((v["resumed"], got["resume"], got["msg"]), (True, ["claude", "--resume", "S1"], self.commands.RESUME_NUDGE))
        self.assertNotIn("stopped_by", self.task(1))

    def test_a_person_stopping_it_is_no_news_but_a_crash_is(self):
        import herdr_task.news as news
        self.begun()
        self.agent("idle", turn=4)
        self.change(stopped_by="you", stopped_why="Stopped by you.", stopped_at=1, stopped_turns={"t9": 4}, space="sp1")
        with self.store_mod.Store(self.store_mod.locate(self.folder), write=False) as s:
            self.assertEqual(news.news_state(s, s.find(1), list(self.live))[1], None)
        self.change(stopped_by="limit", stopped_why="Out of allowance until 3pm")
        with self.store_mod.Store(self.store_mod.locate(self.folder), write=False) as s:
            t = s.find(1)
            v, event, _ = news.news_state(s, t, list(self.live))
            self.assertEqual(event, "failed")
            self.assertIn('"Fix login" failed: Out of allowance until 3pm', news.news_line(s, t, v, event))

    # ---- replying ----

    def test_a_reply_to_a_done_task_starts_its_agent_again(self):
        self.begun()
        self.change(state="done", done_at=5, merged=True, closed_unmerged=True, quiet="told", told="x")
        self.live[:] = []
        told = []
        with self.mock.patch.object(self.commands, "start_again", lambda s, t, space, key=None, argv_json=None, message=None, **k: (
                told.append((space, message)), ({"address": "t10"}, True))[1]):
            v = self.run_cmd(self.commands.cmd_reply, id="1", text="One more thing: the footer.")
        self.assertEqual(told, [("sp1", "One more thing: the footer.")])
        self.assertEqual((v["state"], v["new_agent"], v["reopened"], v["terminal"]), ("running", True, True, "t10"))
        t = self.task(1)
        self.assertTrue(t["kept_open"])  # its work merged before: it stays open until it says ready again
        for k in ("merged", "closed_unmerged", "quiet", "told"):
            self.assertNotIn(k, t)

    def test_a_reply_reaches_a_running_agent_and_clears_stopped(self):
        import herdr_task.news as news
        self.begun()
        self.agent("idle", turn=4)
        self.change(stopped_by="you", stopped_why="Stopped by you.", stopped_at=1, stopped_turns={"t9": 4})
        sent = []
        with self.mock.patch.object(news, "person_send", lambda addr, text: (sent.append((addr, text)), "sent")[1]):
            v = self.run_cmd(self.commands.cmd_reply, id="1", text="Carry on, but skip the footer.")
        self.assertEqual(sent, [("t9", "Carry on, but skip the footer.")])
        self.assertEqual(v["new_agent"], False)
        self.assertNotIn("stopped_by", self.task(1))
        self.add("Not started")
        with self.assertRaises(self.Fail):
            self.run_cmd(self.commands.cmd_reply, id="2", text="hello")

    # ---- the menu: done without merging, archive, move, rename, delete ----

    def test_done_from_the_menu_is_not_merged(self):
        self.begun()
        self.change(mode="worktree", worktree="/nowhere/wt", branch="task/1-fix", pr={"number": 7, "repo": "o/r"})
        with self.mock.patch.object(self.commands, "merged_here", lambda s, t: False):
            v = self.run_cmd(lambda a: self.commands.cmd_state(a, "done"), id="1")
        self.assertEqual((v["state"], v["closed_unmerged"], v.get("merged")), ("done", True, None))
        self.assertEqual(self.task(1)["pr"], {"number": 7, "repo": "o/r"})  # its pull request and branch are left alone
        self.assertEqual(self.hc, [])
        # one in the folder itself is just done
        self.add("In the folder", here=True)
        v = self.run_cmd(lambda a: self.commands.cmd_state(a, "done"), id="2")
        self.assertNotIn("closed_unmerged", v)
        # reopened: no longer closed unmerged
        self.run_cmd(lambda a: self.commands.cmd_state(a, "reopen"), id="1")
        self.assertNotIn("closed_unmerged", self.task(1))

    def test_archive_and_unarchive_by_hand(self):
        import herdr_task.archive as archive
        self.add("Old idea")
        v = self.run_cmd(self.commands.cmd_archive, id="1")
        self.assertTrue(v["archived"])
        self.assertEqual(self.task(1)["archived_by"], "you")
        self.assertEqual(self.listed(), {})
        self.assertEqual(self.run_cmd(self.commands.cmd_list, all=False, archived=True)["tasks"][0]["id"], 1)
        # not done, yet it stays archived: the pass only brings back one whose agent works again
        report = {}
        with self.mock.patch.object(archive, "busy_task_keys", lambda: set()), \
                self.mock.patch.object(archive, "store_files", lambda folder=None: self.store_mod.store_files(folder)):
            archive.archive_pass(report)
        self.assertEqual(report, {})
        self.assertIn("archived", self.task(1))
        self.run_cmd(self.commands.cmd_unarchive, id="1")
        t = self.task(1)
        self.assertNotIn("archived", t)
        self.assertNotIn("archived_by", t)
        # a working task is stopped first
        self.begun("Busy")
        self.agent("working", address="t9")
        self.change(2, state="running", agents=[{"address": "t9", "at": 1}])
        with self.assertRaises(self.Fail) as e:
            self.run_cmd(self.commands.cmd_archive, id="2")
        self.assertIn("stop it first", str(e.exception))

    def test_move_to_another_space_only_before_it_starts(self):
        self.add("Later", space="sp1")
        self.assertEqual(self.task(1)["space"], "sp1")
        base = dict(title=None, prompt=None, prompt_file=None, after=None, at=None, in_=None, here=False, worktree=False, base=None)
        v = self.run_cmd(self.commands.cmd_edit, id="1", space="sp7", **base)
        self.assertEqual((v["space"], self.task(1)["space"]), ("sp7", "sp7"))
        self.run_cmd(self.commands.cmd_start, id="1")
        self.assertEqual(self.started[-1][2], "sp7")  # it starts where it was moved to
        with self.assertRaises(self.Fail) as e:
            self.run_cmd(self.commands.cmd_edit, id="1", space="sp8", **base)
        self.assertIn("only before it starts", str(e.exception))
        # rename works any time
        self.assertEqual(self.run_cmd(self.commands.cmd_edit, id="1", **{**base, "title": "Sooner"})["title"], "Sooner")

    def test_move_to_another_folder(self):
        other = os.path.join(self.tmp, "blog")
        os.makedirs(other)
        self.add("First")
        self.add("Second", after="1", space="sp1", model="opus")
        self.add("Third", after="2")
        base = dict(title=None, prompt=None, prompt_file=None, after=None, at=None, in_=None, here=False, worktree=False, base=None)
        v = self.run_cmd(self.commands.cmd_edit, id="2", space="sp9", move_to=other, **base)
        self.assertEqual((v["moved_from"], v["folder"], v["space"], v["model"], v["state"]), ("APP-2", other, "sp9", "opus", "todo"))
        self.assertNotEqual(v["ref"], "APP-2")
        self.assertEqual([x["ref"] for x in v["after_ext"]], ["APP-1"])  # what it waited for, by its ref now
        with self.assertRaises(self.Fail):
            self.task(2)
        self.assertEqual(self.task(3)["after"], [])
        self.assertEqual([x["ref"] for x in self.task(3)["after_ext"]], [v["ref"]])  # what waited for it follows it
        self.change(1, state="running", started=1)
        with self.assertRaises(self.Fail) as e:
            self.run_cmd(self.commands.cmd_edit, id="1", space="sp9", move_to=other, **base)
        self.assertIn("only before it starts", str(e.exception))

    def test_delete_stops_its_agent(self):
        self.begun()
        self.agent("working")
        v = self.run_cmd(self.commands.cmd_rm, id="1")
        self.assertEqual((v["removed"], v["ended"]), (True, ["t9"]))
        self.assertEqual(self.hc, [["hc", "kill", "t9"]])
        self.assertEqual(self.listed(), {})

    def test_add_without_start_waits(self):
        v = self.add("Later")
        self.assertEqual((v["status"], self.started), ("todo", []))

    # ---- started on any pick ----

    def test_start_takes_model_effort_speed_and_permission(self):
        import herdr_task.settings as settings
        self.add("Fix login")
        for p in (self.mock.patch.object(self.commands, "worker_argv", settings.worker_argv),):
            p.start()
            self.addCleanup(p.stop)
        self.run_cmd(self.commands.cmd_start, id="1", agent="codex", model="gpt-5.5", effort="high", speed="ultrafast", permission="full")
        argv = self.started[-1][1]
        self.assertEqual(argv[:2], ["codex", "--no-daemon"])
        for part in (["-m", "gpt-5.5"], ["-c", 'model_reasoning_effort="high"'], ["-c", 'service_tier="ultrafast"']):
            self.assertIn(part, [argv[i:i + 2] for i in range(len(argv))], argv)
        self.assertIn("--dangerously-bypass-approvals-and-sandbox", argv)
        t = self.task(1)
        self.assertEqual((t["model"], t["effort"], t["speed"], t["perm"]), ("gpt-5.5", "high", "ultrafast", "full"))
        # Claude Code's words, on add and edit
        v = self.add("Plan it", model="opus", speed="fast", permission="plan")
        with self.store_mod.Store(self.store_mod.locate(self.folder)) as s:
            argv = settings.worker_argv(s, s.find(2), "sp1")
        self.assertIn(["--permission-mode", "plan"], [argv[i:i + 2] for i in range(len(argv))])
        self.assertIn(["--settings", json.dumps({"fastMode": True})], [argv[i:i + 2] for i in range(len(argv))])
        base = dict(title=None, prompt=None, prompt_file=None, after=None, at=None, in_=None, here=False, worktree=False, base=None)
        self.run_cmd(self.commands.cmd_edit, id="2", speed="regular", permission="", **base)
        t = self.task(2)
        self.assertEqual((t["speed"], t.get("perm")), ("regular", None))
        with self.assertRaises(self.Fail):
            self.run_cmd(self.commands.cmd_edit, id="2", speed="warp", **base)
        with self.assertRaises(self.Fail):
            self.run_cmd(self.commands.cmd_edit, id="2", permission="root", **base)
        # #1464: Codex's Approve for me, for one task, by its id or its words
        for word in ("approve", "Approve for me"):
            self.run_cmd(self.commands.cmd_edit, id="1", permission=word, **base)
            self.assertEqual(self.task(1)["perm"], "approve")
        with self.store_mod.Store(self.store_mod.locate(self.folder)) as s:
            self.assertIn("--approve-for-me", settings.worker_argv(s, s.find(1), "sp1", agent="codex"))

    # ---- Instructions: gone (SHEP-319), agents read AGENTS.md / CLAUDE.md natively ----

    def test_old_instructions_reach_no_brief(self):
        import herdr_task.settings as settings
        import herdr_task.launch as launch
        with open(settings.SETTINGS, "w") as f:
            json.dump({"everywhere": {"instructions": "Write British English."},
                       "spaces": {"sp1": {"folder": self.folder, "instructions": "This shop sells tea."}}}, f)
        self.add("Fix login")
        with self.store_mod.Store(self.store_mod.locate(self.folder)) as s:
            with self.mock.patch.object(launch, "instructions", lambda role: "You work on one task."), \
                    self.mock.patch.object(launch, "keep_review", lambda *a: None):
                brief = launch.brief(s, s.find(1), None, "sp1", ["claude"])
                handoff = launch.handoff(s, s.find(1), None, argv=["claude"])
        self.assertIn("Settings:", brief)
        for text in (brief, handoff):
            for gone in ("British", "sells tea", "Instructions from the person"):
                self.assertNotIn(gone, text)
        self.assertFalse(hasattr(settings, "instructions_part"))


class NamedByTitle(unittest.TestCase):
    """SHEP-322: no task numbers for people. A task is named by its title; its key (APP-1) stays the hidden id that
    commands, links and tags carry. Commands take either; a title that fits several is refused, never guessed. A real
    task list on disk and a throwaway git repo (Scheduled's)."""
    setUp, run_cmd, add, task = Scheduled.setUp, Scheduled.run_cmd, Scheduled.add, Scheduled.task

    def find(self, what):
        with self.store_mod.Store(self.store_mod.locate(self.folder), write=False) as s:
            return s.find(what)["id"]

    def test_a_title_a_part_of_one_or_the_key(self):
        a, b = self.add("Add the API route"), self.add("Use it in the page")
        self.assertEqual((a["ref"], b["ref"]), ("APP-1", "APP-2"))
        for what in ("Add the API route", "add the  api ROUTE", '"Add the API route"', "API route", "APP-1", "app-1", "1", "#1"):
            self.assertEqual(self.find(what), 1, what)
        self.assertEqual(self.find("in the page"), 2)
        # a title that reads like a key is found by its title
        self.add("GPT-5 support")
        self.assertEqual(self.find("GPT-5 support"), 3)
        self.assertEqual(self.find("gpt-5"), 3)
        with self.assertRaisesRegex(self.Fail, 'No task "Nothing like it"'):
            self.find("Nothing like it")

    def test_a_title_that_fits_several_is_refused_with_each_listed(self):
        self.add("Fix login")
        self.add("Fix login")
        self.add("Fix login on phones")
        # the exact title fits two: refused, each listed with its key, nothing changed
        with self.assertRaises(self.Fail) as e:
            self.run_cmd(self.commands.cmd_edit, id="Fix login", prompt="Changed")
        msg = str(e.exception)
        self.assertIn('2 tasks here fit "Fix login", so nothing was done', msg)
        self.assertIn("APP-1", msg)
        self.assertIn("APP-2", msg)
        self.assertNotIn("APP-3", msg)  # the exact title wins over a part of a longer one
        self.assertEqual([self.task(n)["prompt"] for n in (1, 2)], ["", ""])
        # a part that fits all three is refused too; the key always names one
        with self.assertRaisesRegex(self.Fail, "3 tasks here fit"):
            self.find("login")
        self.assertEqual(self.find("on phones"), 3)
        self.run_cmd(self.commands.cmd_edit, id="APP-2", prompt="Changed")
        self.assertEqual([self.task(n)["prompt"] for n in (1, 2)], ["", "Changed"])

    def test_old_keys_still_resolve_from_anywhere(self):
        self.add("Add the API route")
        elsewhere = tempfile.mkdtemp(dir=self.tmp)
        cwd = os.getcwd()
        os.chdir(elsewhere)
        self.addCleanup(os.chdir, cwd)
        v = self.run_cmd(self.commands.cmd_show, folder=None, id="APP-1")
        self.assertEqual((v["ref"], v["title"]), ("APP-1", "Add the API route"))
        self.assertEqual(self.run_cmd(self.commands.cmd_show, id="Add the API route")["ref"], "APP-1")

    def test_after_by_title_and_its_reason_names_the_title(self):
        self.add("Add the API route")
        self.add("Write the docs")
        v = self.add("Use it in the page", after="Add the API route, Write the docs")
        t = self.task(3)
        self.assertEqual(t["after"], [1, 2])
        self.add("Ship it", after="1 2")  # keys alone, split by spaces as before
        self.assertEqual(self.task(4)["after"], [1, 2])
        self.run_cmd(self.commands.cmd_start, id="Add the API route")
        q = self.run_cmd(self.commands.cmd_start, id="Use it in the page")
        self.assertTrue(q["queued"])
        self.assertEqual(q["reason"], 'after "Add the API route", "Write the docs"')
        self.assertNotIn("APP-", q["reason"])
        with self.assertRaisesRegex(self.Fail, 'No task "Nothing"'):
            self.add("Later", after="Nothing")

    def test_what_it_says_names_the_title(self):
        out = self.io.StringIO()
        with self.redirect(out):
            self.commands.cmd_add(self.argparse.Namespace(**{**dict(folder=self.folder, json=False, title="Fix login", prompt=None,
                prompt_file=None, here=False, worktree=False, after=None, space=None, at=None, in_=None, agent=None, model=None,
                effort=None, argv=None, parent=None, now=False, base=None, start_notes=None, finish_notes=None, set=None)}))
        self.assertTrue(out.getvalue().startswith('"Fix login" added'), out.getvalue())
        from herdr_task.output import line
        with self.store_mod.Store(self.store_mod.locate(self.folder), write=False) as s:
            from herdr_task.output import view
            text = line(view(s, s.find(1)))
        self.assertTrue(text.startswith("To do") and "Fix login" in text and text.endswith("[key APP-1]"), text)

    def test_the_brief_names_its_task_by_title(self):
        from herdr_task import launch
        self.add("Fix login", prompt="Make the login work.")
        with self.store_mod.Store(self.store_mod.locate(self.folder), write=False) as s:
            t = s.find(1)
            b = launch.brief(s, t, space="sp1", argv=["claude"])
            h = launch.handoff(s, t, None, argv=["claude"])
        self.assertIn('Your task, "Fix login":\nMake the login work.', b)
        self.assertNotIn("Your task, APP-1", b)
        self.assertIn('You are taking over the task "Fix login" from another agent.', h)
        # its commands still carry the key, which only commands read
        self.assertIn("ready APP-1 --folder", b)

    def test_the_prefix_setting_is_gone(self):
        self.add("Fix login")
        v = self.run_cmd(self.commands.cmd_config, prefix="ZZ")
        self.assertTrue(v["prefix_ignored"])
        self.assertNotIn("prefix", v)
        self.assertEqual(self.task(1)["id"], 1)
        self.assertEqual(self.find("APP-1"), 1)  # its key is as it was
        r = subprocess.run([sys.executable, os.path.join(BIN, "herdr-task"), "config", "--help"], capture_output=True, text=True)
        self.assertNotIn("--prefix", r.stdout)


class Schedules32(unittest.TestCase):
    """3.2: a schedule (stored as an automation) runs on a time, a repeat or an event; every run is a new ordinary task
    named after it; a one-off leaves the list; a run that changed nothing ends without review (ready --nothing / --told)."""
    run_cmd, tick_at, task = Scheduled.run_cmd, Scheduled.tick_at, Scheduled.task

    def add(self, title, **kw):
        return Scheduled.add(self, title, **{"here": True, **kw})

    def setUp(self):
        Scheduled.setUp(self)
        from unittest import mock
        import herdr_task.automations as au
        self.mock, self.au = mock, au

        def begin(s, t, argv, space, parent=None):
            t["state"], t["started"] = "running", 1
            s.dirty = True
            self.started.append((s.ref(t), argv, space, parent))
            return {"address": "t9", "agent": "claude"}
        later = lambda: self.clock if self.clock is not None else int(__import__("time").time() * 1000)
        for name, value in (("begin", begin), ("ensure_scheduler", lambda quiet=False: {}), ("default_space", lambda: "sp1"),
                            ("worker_argv", lambda s, t, space, key=None: ["claude"]), ("live_agents", lambda key: []), ("now", later)):
            p = mock.patch.object(au, name, value)
            p.start()
            self.addCleanup(p.stop)

    def auto(self, sub, **kw):
        base = dict(auto=sub, folder=self.folder, json=True, id=None, title=None, prompt=None, prompt_file=None, every=None, on=None,
                    when=None, match=None, from_=None, agent=None, space=None, parent=None, set=None, here=True, worktree=False, all=False)
        out = self.io.StringIO()
        with self.redirect(out):
            self.au.cmd_auto(self.argparse.Namespace(**{**base, **kw}))
        return json.loads(out.getvalue())

    def round(self, ms=None):
        """One scheduler look at this folder at that moment."""
        self.clock = ms
        report = {"started": [], "done": [], "attention": [], "fired": []}
        seen = self.__dict__.setdefault("seen", {})
        with self.store_mod.Store(self.store_mod.locate(self.folder)) as s:
            self.au.automations_pass(s, seen, report)
        return report["fired"]

    def test_a_schedule_by_its_title(self):
        """SHEP-322: a schedule is named by its title too; one that fits several is refused."""
        self.auto("add", title="Dependency check", prompt="x", when="mondays 9:00")
        self.auto("add", title="Look for stuck work", prompt="x", when="every 30 minutes")
        self.auto("add", title="Look for stuck work", prompt="x", when="every 2 hours")
        self.assertEqual(self.auto("show", id="Dependency check")["ref"], "APP-A1")
        self.assertEqual(self.auto("show", id="dependency")["ref"], "APP-A1")
        self.assertEqual(self.auto("show", id="APP-A2")["title"], "Look for stuck work")
        with self.assertRaisesRegex(self.Fail, '2 schedules here fit "Look for stuck work"'):
            self.auto("pause", id="Look for stuck work")
        self.assertFalse(self.auto("show", id="APP-A2")["paused"])
        out = self.io.StringIO()
        with self.redirect(out):
            self.au.cmd_auto(self.argparse.Namespace(**dict(auto="pause", folder=self.folder, json=False, id="Dependency check", title=None,
                prompt=None, prompt_file=None, every=None, on=None, when=None, match=None, from_=None, agent=None, space=None,
                parent=None, set=None, here=True, worktree=False, all=False)))
        self.assertEqual(out.getvalue().strip(), '"Dependency check" paused.')

    def test_when_in_plain_words(self):
        w = self.au.parse_when
        every, on = w("Mondays 9:00")
        self.assertEqual((every["kind"], every["days"], every["times"], on), ("at", [0], ["09:00"], None))
        self.assertEqual(w("every 30 minutes")[0]["minutes"], 30)
        self.assertEqual(w("every monday at 9am")[0]["times"], ["09:00"])
        self.assertEqual(w("weekdays 5:30 pm")[0]["times"], ["17:30"])
        self.assertEqual(w("daily 9:00,17:30")[0]["times"], ["09:00", "17:30"])
        self.assertEqual(w("once fri 9:00")[0]["kind"], "once")
        for words, events in (("when a task is merged", ["merged"]), ("When a task is done", ["done"]), ("when checks fail", ["checks-fail"]),
                              ("whenever a task is ready", ["ready"]), ("when a task needs me", ["needs-you"]), ("when a task fails", ["failed"]),
                              ("when a task stalls", ["stalled"]), ("when a task is added", ["added"]),
                              ("when a task is merged or when checks fail", ["checks-fail", "merged"]), ("when merged", ["merged"])):
            self.assertEqual(w(words), (None, events), words)
        every, on = w("weekdays 9:00, when checks fail")
        self.assertEqual((every["times"], on), (["09:00"], ["checks-fail"]))
        for words in ("", "sometime soon", "when the moon is full", "mondays 9"):
            with self.assertRaises(self.Fail, msg=words):
                w(words)
        # what a view says in "when" is taken back as it is
        a = self.auto("add", title="Both", prompt="Go.", when="Mondays 9:00, when a task is merged")
        self.assertEqual(a["when"], "Mondays 9:00, when a task is merged")
        self.assertEqual(self.au.parse_when(a["when"])[1], ["merged"])
        self.assertEqual((a["events"], a["on"], a["once"], a["active"]), (["merged"], ["merged"], False, True))

    def test_every_run_is_a_task_named_after_its_schedule(self):
        a = self.auto("add", title="Look for stuck work", prompt="Look around.", when="every 30 minutes", space="sp1", agent="codex")
        self.assertEqual((a["ref"], a["name"], a["what"], a["when"], a["agent"], a["space"], a["runs"], a["last"]),
                         ("APP-A1", "Look for stuck work", "Look around.", "every 30 minutes", "codex", "sp1", [], None))
        self.assertIsNotNone(a["next_run"])
        v = self.auto("run-now", id="1")
        t = self.task(1)
        self.assertEqual((t["title"], t["automation"], t["automation_title"], t["automation_ref"], t["space"], t["agent"], t["state"]),
                         ("Look for stuck work", 1, "Look for stuck work", "APP-A1", "sp1", "codex", "running"))
        self.assertTrue(t["prompt"].startswith("Look around.\n\nThis task is one run of a schedule."), t["prompt"])
        for words in ("ready APP-1", "--nothing", '--told "', "hand it in like any task"):
            self.assertIn(words, t["prompt"])
        self.assertEqual((v["runs"][-1]["task"], v["runs"][-1]["ended"], v["last"]["why"]), ("APP-1", "working", "run now"))
        shown = self.auto("show", id="1")
        self.assertEqual(shown["last_task"], "APP-1")
        listed = self.auto("list", all=False)
        self.assertEqual([(x["id"], x["name"], x["active"]) for x in listed], [(1, "Look for stuck work", True)])

    def test_the_schedules_plugin_off_starts_no_run(self):
        """Settings › Plugins: Schedules off (Everywhere's plugins_off), the scheduler starts no schedule's run; on again, it does."""
        import time
        self.auto("add", title="Sweep", prompt="Go.", when="every 30 minutes")
        t = int(time.time() * 1000)
        with self.mock.patch.object(self.au, "plugin_off", lambda name: name == "schedules"):
            self.assertEqual(self.round(t + 31 * 60000), [])
            self.assertFalse(self.auto("show", id="1")["active"])
        self.assertTrue(self.auto("show", id="1")["active"])
        fired = self.round(t + 62 * 60000)
        self.assertEqual([(f["automation"], f["why"]) for f in fired], [("APP-A1", "time")])

    def test_the_last_50_runs_are_kept_each_with_how_it_ended(self):
        self.auto("add", title="Sweep", prompt="Go.", when="hourly")
        for _ in range(53):
            self.auto("run-now", id="1")
        with self.store_mod.Store(self.store_mod.locate(self.folder)) as s:
            ts = {t["id"]: t for t in s.data["tasks"]}
            ts[53].update(state="done", quiet="nothing")
            ts[52].update(state="done", quiet="told", told="All green.")
            ts[51].update(state="done", merged=True)
            ts[50].update(state="ready")
            s.data["tasks"].remove(ts[49])
            s.dirty = True
        runs = self.auto("show", id="1")["runs"]
        self.assertEqual((len(runs), runs[0]["task"], runs[-1]["task"]), (50, "APP-4", "APP-53"))
        self.assertEqual([r["ended"] for r in runs[-6:]], ["working", "removed", "ready", "merged", "told", "nothing"])
        self.assertTrue(all("at" in r and "task" in r for r in runs))

    def test_a_one_off_leaves_the_list_after_its_run(self):
        import datetime
        a = self.auto("add", title="Renew the domain", prompt="Remind them.", when="once tomorrow 9:00")
        self.assertTrue(a["once"])
        due = a["next_run"]
        self.assertEqual(self.round(due - 60000), [])
        fired = self.round(due + 1000)
        self.assertEqual([(f["automation"], f["task"], f["why"]) for f in fired], [("APP-A1", "APP-1", "time")])
        self.assertEqual(self.auto("list", all=False), [])  # gone from the list; its task carries on by itself
        self.assertEqual(self.task(1)["automation_title"], "Renew the domain")
        self.assertEqual(self.round(due + 60000), [])

    def test_a_run_missed_while_the_machine_was_off_runs_once(self):
        a = self.auto("add", title="Sweep", prompt="Go.", when="every 30 minutes")
        back = a["next_run"] + 8 * 3600000  # off for eight hours: sixteen runs missed
        self.assertEqual(len(self.round(back)), 1)
        self.assertEqual(self.round(back + 15000), [])
        nxt = self.auto("show", id="1")["next_run"]
        self.assertTrue(back < nxt <= back + 30 * 60000 + 60000, (back, nxt))

    def test_an_archived_spaces_schedules_stop(self):
        a = self.auto("add", title="Sweep", prompt="Go.", when="every 30 minutes", space="sp1")
        self.auto("add", title="Other space's", prompt="Go.", when="every 30 minutes", space="sp2")
        self.auto("add", title="Paused by hand", prompt="Go.", when="every 30 minutes", space="sp1")
        self.auto("pause", id="3")
        with self.mock.patch.object(self.au, "store_files", lambda folder=None: self.store_mod.store_files(folder)):
            out = self.auto("pause", space="sp1", all=True)
            self.assertEqual([(x["id"], x["space_paused"], x["active"]) for x in out], [(1, True, False), (3, True, False)])
            fired = self.round(a["next_run"] + 1000)
            self.assertEqual([f["automation"] for f in fired], ["APP-A2"])
            out = self.auto("resume", space="sp1", all=True)
        self.assertEqual([(x["id"], x["space_paused"], x["paused"], x["active"]) for x in out], [(1, False, False, True), (3, False, True, False)])
        with self.assertRaises(self.Fail):
            self.auto("pause")  # neither an id nor a space

    def test_done_and_checks_fail_are_events(self):
        d = self.au.diff_events
        seen = {}
        f = lambda **kw: {"id": 1, "ref": "APP-1", "title": "x", "state": "running", "status": "working", "needs": None, "attention": None,
                          "attention_head": None, "merged": False, "automation": None, "quiet": None, **kw}
        self.assertEqual(d([f()], seen), [])
        self.assertEqual([e for e, _ in d([f(attention="Checks failing: test", attention_head="abc")], seen)], ["failed", "checks-fail"])
        self.assertEqual([e for e, _ in d([f(attention="It conflicts with main", attention_head="abc")], seen)], ["failed"])
        self.assertEqual([e for e, _ in d([f(state="done", status="done")], seen)], ["done"])
        self.assertEqual([e for e, _ in d([f(id=2, state="done", status="done", merged=True)], seen)], ["done", "merged"])
        # a schedule's quiet run is no "a task is done" (a look-around every 30 minutes would set off every such schedule)
        self.assertEqual(d([f(id=3)], seen), [("added", f(id=3))])
        self.assertEqual(d([f(id=3, state="done", status="done", quiet="nothing")], seen), [])
        self.assertEqual(self.au.EVENTS, ["added", "ready", "failed", "checks-fail", "needs-you", "done", "merged", "stalled"])

    def ready(self, **kw):
        base = dict(summary=None, details=None, proof=None, agents_md=None, pr=None, pr_title=None, pr_body=None, draft=False, nothing=False, told=None)
        return self.run_cmd(self.commands.cmd_ready, **{**base, **kw})

    def test_nothing_to_do_is_done_at_once(self):
        import herdr_task.news as news
        self.auto("add", title="Sweep", prompt="Go.", when="hourly", space="sp1")
        self.auto("run-now", id="1")
        with self.mock.patch.object(self.commands, "finish", self.commands.finish), \
                self.mock.patch("herdr_task.github.after_accept", lambda s, t: self.fail("nothing was accepted")), \
                self.mock.patch("herdr_task.github.live_agents", lambda key: []), self.mock.patch("herdr_task.github.mid_turn", lambda s, t: False):
            v = self.ready(id="1", nothing=True)
        self.assertEqual((v["state"], v["quiet"], v["summary"], v["status"]), ("done", "nothing", "Nothing to do", "done"))
        t = self.task(1)
        self.assertNotIn("told", t)
        self.assertFalse(news.untold(t))  # no message
        self.assertEqual(self.auto("show", id="1")["last"]["ended"], "nothing")

    def test_only_something_to_say_is_told_and_done(self):
        import herdr_task.news as news
        self.auto("add", title="Morning brief", prompt="Brief me.", when="weekdays 8:00", space="sp1")
        self.auto("run-now", id="1")
        with self.mock.patch("herdr_task.github.after_accept", lambda s, t: self.fail("nothing was accepted")), \
                self.mock.patch("herdr_task.github.live_agents", lambda key: []), self.mock.patch("herdr_task.github.mid_turn", lambda s, t: False):
            v = self.ready(id="1", told="Two tasks are ready for review;\n  nothing is stuck.")
        self.assertEqual((v["state"], v["quiet"], v["told"]), ("done", "told", "Two tasks are ready for review; nothing is stuck."))
        t = self.task(1)
        self.assertTrue(news.untold(t))  # its words go to its space's chat, once (news_pass)
        with self.store_mod.Store(self.store_mod.locate(self.folder), write=False) as s:
            line = news.news_line(s, s.find(1), {}, "told", t["told"])
        self.assertEqual(line, '<herdr-news task="APP-1" event="told">"Morning brief", a schedule\'s run, says: '
                               'Two tasks are ready for review; nothing is stuck.</herdr-news>')
        self.assertFalse(news.untold({**t, "told_sent": 5}))
        self.assertEqual(self.auto("show", id="1")["last"]["ended"], "told")

    def test_only_a_schedules_run_that_changed_nothing(self):
        self.add("By hand")
        with self.assertRaises(self.Fail) as e:
            self.ready(id="1", nothing=True)
        self.assertIn("wasn't started by a schedule", str(e.exception))
        self.auto("add", title="Sweep", prompt="Go.", when="hourly", space="sp1")
        self.auto("run-now", id="1")
        head = subprocess.run(["git", "-C", self.folder, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
        with self.store_mod.Store(self.store_mod.locate(self.folder)) as s:
            s.find(2)["folder_start"] = head
            s.dirty = True
        subprocess.run(["git", "-C", self.folder, "-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "a change"], check=True)
        for kw in ({"nothing": True}, {"told": "Done it."}):
            with self.assertRaises(self.Fail) as e:
                self.ready(id="2", **kw)
            self.assertIn("changed things", str(e.exception))
        self.assertEqual(self.task(2)["state"], "running")  # it goes through review like any task
        with self.assertRaises(self.Fail):
            self.ready(id="2", nothing=True, told="x")
        with self.assertRaises(self.Fail):
            self.ready(id="2", told="  ")


class ParallelCollisions(unittest.TestCase):
    """SHEP-320: tasks run in parallel, also on the same lines; a merge collision goes back to the later task's agent
    fast, naming the files and the task that merged first, the card says why in one line, and the merge already asked
    for goes through by itself once fixed. A real throwaway origin, clone and worktrees; gh and hc are faked."""

    def setUp(self):
        from unittest import mock
        import shutil
        sys.path.insert(0, BIN)
        import herdr_task.commands as commands
        import herdr_task.github as github
        import herdr_task.ghnews as ghnews
        import herdr_task.launch as launch
        import herdr_task.tick as tick
        self.commands, self.github, self.ghnews, self.launch, self.tick, self.mock = commands, github, ghnews, launch, tick, mock
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.origin, self.main, self.other = (os.path.join(self.root, x) for x in ("origin.git", "repo", "other"))
        self.git(self.root, "init", "-q", "--bare", "-b", "main", self.origin)
        self.git(self.root, "clone", "-q", self.origin, self.main)
        self.write(self.main, "app.txt", "title\nhello\nend\n")
        self.write(self.main, "other.txt", "x\n")
        self.commit(self.main, "first")
        self.git(self.main, "push", "-q", "origin", "main")
        self.start = self.git(self.main, "rev-parse", "HEAD")
        self.store = Store([])
        self.store.loc["folder"] = self.main
        self.patch(commands, "open_store", lambda args, write=True, wait=None: self.store)
        self.patch(commands, "view", lambda s, t, live=None: dict(t))
        self.patch(commands, "say", lambda *a: self.said.append(a))
        self.patch(commands, "live_agents", lambda key: [])
        self.patch(commands, "refresh_sessions", lambda *a: None)
        self.said, self.told = [], []
        self.patch(commands, "tell", lambda s, t, msg, args: (self.told.append(msg), ("t9", False))[1])

    def patch(self, mod, name, value):
        p = self.mock.patch.object(mod, name, value)
        p.start()
        self.addCleanup(p.stop)

    def git(self, cwd, *args):
        return subprocess.run(["git", "-C", cwd, "-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false",
                               *args], capture_output=True, text=True, check=True).stdout.strip()

    def write(self, cwd, name, text):
        with open(os.path.join(cwd, name), "w") as f:
            f.write(text)

    def commit(self, cwd, words):
        self.git(cwd, "add", "-A")
        self.git(cwd, "commit", "-q", "-m", words)
        return self.git(cwd, "rev-parse", "HEAD")

    def task(self, n, line, name="app.txt", state="running"):
        """Task n in its own worktree from the start, changing name's middle line to line, committed."""
        wt, br = os.path.join(self.root, f"wt{n}"), f"task/{n}"
        self.git(self.main, "worktree", "add", "-q", "-b", br, wt, self.start)
        self.write(wt, name, "title\n" + line + "\nend\n" if name == "app.txt" else line + "\n")
        self.commit(wt, f"task {n}")
        t = {"id": n, "title": f"Task {n}", "state": state, "mode": "worktree", "worktree": wt, "branch": br, "base": "main",
             "start": self.start, "agents": []}
        self.store.data["tasks"].append(t)
        return t

    def merge_first(self, t, words="SHEP-1: Task 1 (#11)"):
        """t's work lands on GitHub's main as a squash commit (as GitHub would), from another clone."""
        self.git(self.root, "clone", "-q", self.origin, self.other)
        self.git(self.other, "fetch", "-q", t["worktree"], t["branch"])
        self.git(self.other, "merge", "-q", "--squash", "FETCH_HEAD")
        self.commit(self.other, words)
        self.git(self.other, "push", "-q", "origin", "main")

    def test_two_tasks_on_the_same_line_collide_and_its_agent_hears_what(self):
        a, b, c = self.task(1, "A"), self.task(2, "B"), self.task(3, "C", name="other.txt")
        self.assertIsNone(self.github.collision(self.store, b, fetch=True))  # nothing merged yet
        self.merge_first(a)
        hit = self.github.collision(self.store, b, fetch=True)
        self.assertEqual((hit["files"], hit["by"], hit["ref"]), (["app.txt"], ['"Task 1"'], "origin/main"))
        self.assertEqual(self.github.collision_reason(hit), "Conflicts with main after \"Task 1\" merged: its agent is rebasing")
        # SHEP-322: a merge titled the new way ("Task 1 (#11)", no key) is found by its pull request's number
        self.assertEqual(self.github.merged_by(self.store, "Task 1 (#11)"), None)
        a["pr"] = {"number": 11}
        self.assertEqual(self.github.merged_by(self.store, "Task 1 (#11)"), '"Task 1"')
        self.assertEqual(self.github.merged_by(self.store, "Someone else's (#12)"), None)
        words = self.github.collision_words(hit)
        self.assertIn("Files that collide with origin/main: app.txt.", words)
        self.assertIn("SHEP-1: Task 1 (#11)", words)
        self.assertIn("git rebase origin/main", words)
        self.assertIsNone(self.github.collision(self.store, c))  # behind, but clean: no collision
        # without a task's name in the base's commit: the card names the file
        self.assertEqual(self.github.collision_reason({**hit, "by": []}), "Conflicts with main in app.txt: its agent is rebasing")
        # its agent rebases and resolves: no collision any more
        self.git(b["worktree"], "fetch", "-q", "origin")
        r = subprocess.run(["git", "-C", b["worktree"], "rebase", "origin/main"], capture_output=True)
        self.assertNotEqual(r.returncode, 0)
        self.write(b["worktree"], "app.txt", "title\nA and B\nend\n")
        self.git(b["worktree"], "add", "app.txt")
        self.git(b["worktree"], "-c", "core.editor=true", "rebase", "--continue")
        self.assertIsNone(self.github.collision(self.store, b, fetch=True))

    def ready_args(self, **kw):
        import argparse
        return argparse.Namespace(id=f"SHEP-{kw.pop('n', 2)}", json=False, folder=None, summary="Fixed it", details=None, pr=None,
                                  agents_md=None, proof=None, nothing=False, told=None, **kw)

    def test_ready_refuses_a_branch_that_conflicts_with_its_base(self):
        a, b, c = self.task(1, "A"), self.task(2, "B"), self.task(3, "C", name="other.txt")
        self.merge_first(a)
        for name in ("take_pr", "base_pr", "pr_words"):
            self.patch(self.commands, name, lambda *x, **k: None)
        self.patch(self.commands, "review_refusal", lambda s, t, wt: None)
        self.patch(self.commands, "finalize", lambda s, t: f"{s.ref(t)} is ready.")
        self.patch(self.commands, "find_proof", lambda *x: None)
        self.patch(self.commands, "task_settings", lambda s, t: [])
        with self.assertRaises(self.commands.Fail) as e:
            self.commands.cmd_ready(self.ready_args())
        self.assertIn("\"Task 2\"'s branch conflicts with origin/main, which moved on since it started (\"Task 1\" merged)", str(e.exception))
        self.assertIn("app.txt", str(e.exception))
        self.assertEqual(b["state"], "running")
        # behind but clean: ready
        self.commands.cmd_ready(self.ready_args(n=3))
        self.assertEqual(self.said[-1][2], "SHEP-3 is ready.")

    def test_a_merge_that_collides_goes_back_named_and_merges_without_a_second_ask(self):
        a, b = self.task(1, "A"), self.task(2, "B", state="ready")
        b["pr"] = {"number": 12, "repo": "o/r", "checked": 5, "url": "https://github.example/o/r/pull/12"}
        self.merge_first(a)
        conflict = {"state": "OPEN", "mergeable": "CONFLICTING", "statusCheckRollup": [], "headRefOid": "abc"}
        self.patch(self.commands, "pr_view", lambda t: conflict)
        self.patch(self.commands, "merge_checks", lambda t, v, **k: v)
        self.patch(self.commands, "note_checks", lambda *x: None)
        import argparse
        with self.assertRaises(SystemExit):
            self.commands.cmd_accept(argparse.Namespace(id="SHEP-2", json=False, folder=None))  # the person's Mark as done
        self.assertEqual(b["state"], "running")
        self.assertEqual(b["merge_failed"], "Conflicts with main after \"Task 1\" merged: its agent is rebasing")
        self.assertIn("Files that collide with origin/main: app.txt.", self.told[-1])
        self.assertIn("rebase task/2 onto origin/main", self.told[-1])
        self.assertIn("the merge already asked for then goes through by itself", self.told[-1])
        self.assertTrue(b["merge_asked"])
        # fixed and handed in again: Settings say ask first, yet the merge it already had goes through once checks pass
        self.patch(self.commands, "github", lambda s: "o/r")
        self.patch(self.commands, "pr_open", lambda s, t, repo, summary: t["pr"])
        self.patch(self.commands, "merge_policy", lambda s, t: "ask")
        msg = self.commands.finalize(self.store, b)
        self.assertEqual((b["state"], b["auto_merge"]), ("ready", "checks"))
        self.assertIn("The person already asked to merge it: it merges by itself once its checks pass.", msg)
        # a task never asked to merge still waits for the person
        b.pop("merge_asked")
        msg = self.commands.finalize(self.store, b)
        self.assertNotIn("auto_merge", b)
        self.assertIn("The person marks it as done on its card", msg)

    def test_a_ready_tasks_conflict_shows_on_its_card_and_reaches_its_agent_with_the_files(self):
        a, b = self.task(1, "A"), self.task(2, "B", state="ready")
        b.update(pr={"number": 12, "repo": "o/r", "checked": 0, "url": "https://github.example/o/r/pull/12"}, ready_at=1)
        self.merge_first(a)
        conflict = {"state": "OPEN", "mergeable": "CONFLICTING", "statusCheckRollup": [], "headRefOid": "abc"}
        for name, value in (("pr_view", lambda t: conflict), ("note_checks", lambda *x: None), ("seen_pr", lambda s, t: None),
                            ("queue_entry", lambda t: None), ("needs_approval", lambda v: False),
                            ("checks_since", lambda s, t, v: 0), ("expected_checks", lambda s, t, h: []),
                            ("held_by_base", lambda s, t, v: False)):
            self.patch(self.tick, name, value)
        rests = []
        self.patch(self.ghnews, "resting", lambda s, t: rests[-1] if rests else None)
        self.patch(self.tick, "resting", lambda s, t: rests[-1] if rests else None)
        self.patch(self.ghnews, "pr_comments", lambda repo, n: [])
        report = {"attention": [], "done": []}
        # #1357: its agent mid-turn (just said ready): Needs you, the card naming what collided but never claiming
        # its agent rebases, and looked at again soon
        self.tick.facts(self.store, b, report)  # no auto_merge: the person hasn't asked to merge it
        self.assertEqual((b["state"], b["attention"]), ("ready", "It conflicts with the base branch."))
        self.assertEqual(b["merge_failed"], "Conflicts with main after \"Task 1\" merged")
        self.assertEqual(self.told, [])
        self.assertLess(b["pr"]["checked"], self.tick.now() - self.tick.PR_EVERY + self.tick.PR_WAIT_EVERY + 1000)
        # once it rests: handed back at once, Working, and only now "its agent is rebasing"
        rests.append({"address": "t9"})
        b["pr"]["checked"] = 0
        self.tick.facts(self.store, b, report)
        self.assertEqual(b["state"], "running")
        self.assertNotIn("attention", b)
        self.assertEqual(b["merge_failed"], "Conflicts with main after \"Task 1\" merged: its agent is rebasing")
        self.assertIn("Files that collide with origin/main: app.txt.", self.told[-1])
        self.assertIn("rebase task/2 onto origin/main", self.told[-1])
        self.assertEqual(report["merge_failed"][-1]["task"], "SHEP-2")

    def test_a_merge_tells_working_tasks_that_now_collide_at_once(self):
        a, b, c = self.task(1, "A"), self.task(2, "B"), self.task(3, "C", name="other.txt")
        d = self.task(4, "D", state="ready")
        d["pr"] = {"number": 14, "repo": "o/r", "checked": 99}
        self.merge_first(a)
        self.patch(self.github, "after_accept", lambda s, t: None)
        self.patch(self.github, "remove_worktree", lambda s, t: None)
        self.patch(self.github, "mid_turn", lambda s, t: True)
        a["merged"] = True
        self.github.finish(self.store, a)
        self.assertTrue(b.get("base_moved") and c.get("base_moved"))
        self.assertEqual(d["pr"]["checked"], 0)  # a Ready one's pull request is read at the next tick
        sent = []
        import herdr_task.news as news
        self.patch(news, "send_or_hold", lambda address, text, how="send": (sent.append((address, text)), True)[1])
        self.patch(self.tick, "workers", lambda s, t: [{"address": f"t{t['id']}"}])
        report = {}
        for t in (b, c):
            self.tick.heads_up(self.store, t, report)
        self.assertEqual(report["collides"], ["SHEP-2"])  # the clean one hears nothing
        self.assertEqual(sent[0][0], "t2")
        self.assertIn("main moved on (\"Task 1\" merged) and now conflicts with your branch task/2", sent[0][1])
        self.assertIn("app.txt", sent[0][1])
        self.assertNotIn("base_moved", b)
        b["base_moved"] = 1  # another merge elsewhere, the same collision: not told twice
        self.tick.heads_up(self.store, b, report)
        self.assertEqual(len(sent), 1)

    def test_the_brief_and_the_assistant_say_so(self):
        t = self.task(1, "A")
        line = self.launch.closing_line(self.store, t)
        self.assertIn("before ready, fetch and rebase your branch onto main's newest", line)
        self.assertIn("git rebase origin/main", line)
        self.assertNotIn("rebase your branch", self.launch.closing_line(self.store, {**t, "mode": "here"}))
        with open(os.path.join(ROOT, "templates", "assistant.md")) as f:
            words = f.read()
        self.assertIn("With worktrees, tasks run in parallel by default, also when they touch the same files or screens", words)
        self.assertIn("`--after` is only for a task that needs another's result first", words)
        self.assertIn("that fix round is the accepted price", words)
        self.assertNotIn("as parallel edits there conflict at merge", words)
        self.assertIn("tasks touching different files run in parallel", words)


class NeverTypedIntoAShell(unittest.TestCase):
    """SHEP-324: herdr-core lost the agents' programs and kept their terminals as plain shells; messages meant for the
    agents (another Assistant's, news, a task's) were typed into those shells as commands. Now nothing is typed into a
    terminal whose agent isn't in front: an Assistant starts again with the message, a task's agent's message is kept
    for the agent that restarts the task, and the sender is told. A fake hc (no real one runs), a throwaway held file."""

    WORKER_KEY = "dev-shop#7"

    def setUp(self):
        import shutil
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.agents as agents
        import herdr_task.news as news
        import herdr_task.revive as revive
        import herdr_task.machines as machines
        import herdr_task.commands as commands
        self.agents, self.news, self.revive, self.machines, self.commands = agents, news, revive, machines, commands
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.terms = {}
        self.calls = []
        self.next_address = "t9"

        def hc_json(*args):
            return json.loads(json.dumps(self.terms.get(args[1]))) if args[:1] == ("get",) and args[1] in self.terms else None

        def run(args, **kw):
            self.calls.append(list(args))
            out = ""
            if args[:2] == ["hc", "run"]:
                out = json.dumps({"address": self.next_address}) if self.next_address else ""
            if args[:2] == ["hc", "get"]:
                out = json.dumps(self.terms.get(args[2]))
            return types.SimpleNamespace(returncode=0 if (args[:2] != ["hc", "run"] or self.next_address) else 1, stdout=out, stderr="")

        for mod, name, value in ((news, "HELD", os.path.join(self.tmp, "held.json")), (news, "hc_json", hc_json),
                                 (news, "run", run), (news, "guard", lambda a: None), (news.time, "sleep", lambda s: None),
                                 (news, "typing", lambda *a, **k: None),
                                 (news.subprocess, "run", lambda args, **kw: run(args)),
                                 (revive, "hc_json", hc_json), (revive, "run", run),
                                 (revive, "RESTARTS", os.path.join(self.tmp, "restarts.json")),
                                 (revive, "STORE", self.tmp)):
            p = mock.patch.object(mod, name, value)
            p.start()
            self.addCleanup(p.stop)

    def term(self, address, fg, labels=None, **more):
        self.terms[address] = {"address": address, "state": "live", "cwd": "/w", "labels": dict(labels or {}),
                               "foreground": fg, "status": None, **more}
        return self.terms[address]

    SHELL = {"name": "bash", "argv": ["/bin/bash"], "pid": 11}
    CLAUDE = {"name": "claude", "argv": ["claude", "--model", "opus"], "pid": 12}
    RECORD = json.dumps({"kind": "claude", "session": "s-1", "argv": ["claude", "--model", "opus"], "cwd": "/w/shop"})

    def typed(self):
        return [c for c in self.calls if c[:2] == ["hc", "send"]]

    def held(self):
        try:
            with open(self.news.HELD) as f:
                return json.load(f)
        except OSError:
            return {}

    # ---- what is in front ------------------------------------------------------------------------------------------
    def test_front(self):
        f = self.agents.front
        live = lambda fg, **k: {"state": "live", "foreground": fg, **k}
        self.assertEqual(f(live(self.SHELL)), "shell")
        self.assertEqual(f(live({"name": "zsh", "argv": ["-zsh"]})), "shell")
        self.assertEqual(f(live({"name": "bash", "argv": ["/bin/bash", "-ic", '"$@"; exec "$0" -i', "/bin/bash", "claude"]})), "agent")
        self.assertEqual(f(live({"name": "fish", "argv": ["fish", "-ic", "claude; exec fish -i"]})), "agent")
        self.assertEqual(f(live(self.CLAUDE, labels={"herdr.agent": "claude"})), "agent")
        self.assertEqual(f(live({"name": "node", "argv": ["node", "codex"]}, labels={"herdr.agent": "codex"})), "agent")
        self.assertEqual(f(live({"name": "2.1.330"}, labels={"herdr.agent": "claude"})), "agent")
        self.assertEqual(f(live({"name": "vim", "argv": ["vim"]}, labels={"herdr.agent": "claude"})), "other")
        self.assertEqual(f({"state": "finished"}), "gone")
        self.assertEqual(f(None), "gone")
        self.assertEqual(f({"state": "live", "agent": "bash"}), "shell")
        self.assertEqual(f({"state": "live"}), "agent", "not told: as before")

    # ---- a task's agent ----------------------------------------------------------------------------------------------
    def test_a_task_agents_message_is_kept_never_typed_then_goes_with_its_restart(self):
        self.term("t5", self.SHELL, {"herdr.task": self.WORKER_KEY, "herdr.agent": "claude"})
        self.assertTrue(self.news.plain_send("t5", "rm -rf build; your merge failed"))
        self.assertTrue(self.news.news_send("t5", "<herdr-news>checks failed</herdr-news>"))
        self.assertEqual(self.typed(), [], "nothing typed into the shell")
        self.assertEqual([(x["task"], x["text"]) for x in self.held()["t5"]],
                         [(self.WORKER_KEY, "rm -rf build; your merge failed"), (self.WORKER_KEY, "<herdr-news>checks failed</herdr-news>")])
        # the scheduler's pass keeps it (never types it), even once the old terminal is gone
        self.news.held_pass({})
        del self.terms["t5"]
        self.news.held_pass({})
        self.assertEqual(self.typed(), [])
        self.assertEqual(len(self.held()["t5"]), 2)
        # the task restarts: its new agent's first message carries them, and they're gone from the held file
        text = self.news.take_kept(self.WORKER_KEY)
        self.assertTrue(text.startswith(self.news.KEPT_INTRO))
        self.assertIn("your merge failed", text)
        self.assertIn("checks failed", text)
        self.assertEqual(self.held(), {})
        self.assertIsNone(self.news.take_kept(self.WORKER_KEY))

    def test_a_live_agent_still_gets_its_message(self):
        self.term("t5", self.CLAUDE, {"herdr.task": self.WORKER_KEY, "herdr.agent": "claude"})
        self.assertTrue(self.news.plain_send("t5", "carry on"))
        self.assertEqual(self.typed(), [["hc", "send", "t5", "carry on"]])
        self.assertEqual(self.news.send_or_hold("t5", "and this", "news"), "sent")
        self.assertEqual(self.typed()[-1], ["hc", "send", "t5", "and this"])
        self.assertEqual(self.held(), {})

    def test_send_or_hold_says_no_agent_and_types_nothing(self):
        self.term("t5", self.SHELL, {"herdr.task": self.WORKER_KEY})
        self.assertEqual(self.news.send_or_hold("t5", "hello"), self.news.NO_AGENT)
        self.assertEqual(self.typed(), [])
        self.assertEqual(self.held(), {}, "the caller decides")

    def test_the_persons_reply_types_nothing_into_a_shell(self):
        self.term("t5", self.SHELL, {"herdr.task": self.WORKER_KEY, "herdr.agent": "claude"})
        self.assertEqual(self.news.person_send("t5", "hello"), self.news.NO_AGENT)
        self.assertEqual(self.typed(), [])
        self.assertEqual(self.held(), {}, "the caller restarts its agent with it")

    def test_another_program_in_front_holds_it_until_the_agent_is_back(self):
        self.term("t5", {"name": "vim", "argv": ["vim"]}, {"herdr.agent": "claude"})
        self.assertEqual(self.news.send_or_hold("t5", "hello"), "held")
        self.news.held_pass({})
        self.assertEqual(self.typed(), [])
        self.terms["t5"]["foreground"] = self.CLAUDE
        self.terms["t5"]["status"] = {"state": "idle"}
        self.news.held_pass({})
        self.assertEqual(self.typed(), [["hc", "send", "t5", "hello"]])

    def test_a_reply_to_a_task_whose_agent_just_exited_restarts_it_with_the_reply(self):
        from unittest import mock
        started = []
        t = {"id": 7, "state": "running"}
        with mock.patch.object(self.commands, "workers", lambda s, t: [{"address": "t5"}]), \
                mock.patch.object(self.news, "send_or_hold", lambda a, m, how="send": self.news.NO_AGENT), \
                mock.patch.object(self.commands, "start_again", lambda s, t, space, *a, message=None, **k: (started.append(message), ({"address": "t9"}, True))[1]):
            got = self.commands.tell(types.SimpleNamespace(dirty=False), t, "the reply", types.SimpleNamespace(space="sp1"))
        self.assertEqual(got, ("t9", True))
        self.assertEqual(started, ["the reply"])
        self.assertEqual(self.typed(), [])

    def test_a_restart_carries_what_was_kept(self):
        from unittest import mock
        self.news.hold("t5", "news for it", "news", task=self.WORKER_KEY)
        seen = []
        s = types.SimpleNamespace(dirty=False, key=lambda t: self.WORKER_KEY)
        with mock.patch.object(self.commands, "live_agents", lambda key: []), \
                mock.patch.object(self.commands, "_start_again", lambda s, t, space, key, argv, message, parent, nudge: (seen.append(message), ({"address": "t9"}, True))[1]):
            self.commands.start_again(s, {"id": 7, "state": "running"}, "sp1", nudge="Carry on.")
        self.assertEqual(len(seen), 1)
        self.assertTrue(seen[0].startswith("Carry on.\n\n" + self.news.KEPT_INTRO))
        self.assertIn("news for it", seen[0])
        self.assertEqual(self.held(), {})
        # a start that fails keeps them for the next one
        self.news.hold("t5", "again", "send", task=self.WORKER_KEY)
        with mock.patch.object(self.commands, "live_agents", lambda key: []), \
                mock.patch.object(self.commands, "_start_again", mock.Mock(side_effect=self.commands.Fail("no"))):
            with self.assertRaises(self.commands.Fail):
                self.commands.start_again(s, {"id": 7, "state": "running"}, "sp1")
        self.assertIn("again", self.news.take_kept(self.WORKER_KEY))

    # ---- an Assistant ------------------------------------------------------------------------------------------------
    def assistant(self, address="t3", record=True):
        labels = {"herdr.role": "coordinator", "herdr.space": "sp1", "herdr.coordinator.space": "sp1", "herdr.agent": "claude"}
        if record:
            labels["herdr.resume"] = self.RECORD
        return self.term(address, self.SHELL, labels)

    def test_an_assistant_starts_again_on_its_conversation_with_the_message(self):
        self.assistant()
        self.assertTrue(self.news.news_send("t3", "<herdr-news>SHOP-7 is ready</herdr-news>"))
        self.assertEqual(self.typed(), [])
        runs = [c for c in self.calls if c[:2] == ["hc", "run"]]
        self.assertEqual(len(runs), 1)
        r = runs[0]
        self.assertEqual(r[r.index("--cwd") + 1], "/w/shop")
        self.assertIn("--keep", r, "no tab: kept in the background, as restart.sh")
        for label in ("herdr.role=coordinator", "herdr.space=sp1", "herdr.coordinator.space=sp1", "herdr.agent=claude"):
            self.assertIn(label, r)
        self.assertEqual(r[-6:], ["claude", "--model", "opus", "--resume", "s-1", "<herdr-news>SHOP-7 is ready</herdr-news>"])
        self.assertIn(["hc", "kill", "t3"], self.calls)
        self.assertIn(["hc", "rm", "t3"], self.calls)

    def test_an_assistant_without_a_record_starts_fresh_with_the_message_as_its_task(self):
        self.assistant(record=False)
        self.assertEqual(self.revive.restart_assistant(self.terms["t3"], "hello"), "t9")
        r = [c for c in self.calls if c[:2] == ["hc", "run"]][0]
        self.assertEqual(r[-2:], ["assistant", "hello"])

    def test_a_failed_restart_is_kept_and_not_tried_in_a_loop(self):
        self.assistant()
        self.next_address = None
        self.assertTrue(self.news.news_send("t3", "news"))
        self.assertEqual([x["text"] for x in self.held()["t3"]], ["news"])
        self.assertNotIn(["hc", "kill", "t3"], self.calls)
        self.news.held_pass({})
        self.assertEqual(len([c for c in self.calls if c[:2] == ["hc", "run"]]), 1, "tried again only after a while")
        self.assertEqual(self.typed(), [])

    def test_a_restart_is_never_started_twice(self):
        self.assistant()
        self.assertEqual(self.revive.restart_assistant(self.terms["t3"], "a"), "t9")
        self.assertIsNone(self.revive.restart_assistant(self.terms["t3"], "b"))
        self.assertEqual(len([c for c in self.calls if c[:2] == ["hc", "run"]]), 1)

    def test_a_held_message_for_an_assistant_that_exited_starts_it_again(self):
        self.term("t3", self.CLAUDE, {"herdr.role": "coordinator", "herdr.resume": self.RECORD})
        self.news.hold("t3", "first")
        self.news.hold("t3", "second")
        self.terms["t3"]["foreground"] = self.SHELL
        report = {}
        self.news.held_pass(report)
        self.assertEqual(self.typed(), [])
        self.assertEqual(report["restarted"], [{"from": "t3", "to": "t9", "messages": 2}])
        r = [c for c in self.calls if c[:2] == ["hc", "run"]][0]
        self.assertEqual(r[-1], "first\n\nsecond")
        self.assertEqual(self.held(), {})

    # ---- tell-assistant -----------------------------------------------------------------------------------------------
    def tell(self, row):
        from unittest import mock
        graph = {"core": {"name": "vm", "id": "c1"}, "assistants": []}
        with mock.patch.object(self.machines, "directory", lambda refresh=False: ({"graph": graph}, [row])), \
                mock.patch.object(self.machines, "nodes", lambda g: []), \
                mock.patch.object(self.machines, "hc_json", lambda *a: self.news.hc_json(*a)):
            return self.machines.tell("sp1", "Can you check SHOP-7?", sender="t1")

    def test_tell_assistant_to_one_that_exited_restarts_it_and_says_so(self):
        self.assistant()
        r = self.tell({"target": "t3", "route": "", "address": "t3", "space": "sp1", "space_name": "shop"})
        self.assertEqual(r["restarted"], "t9")
        self.assertEqual(self.typed(), [])
        self.assertIn("Can you check SHOP-7?", [c for c in self.calls if c[:2] == ["hc", "run"]][0][-1])

    def test_tell_assistant_says_plainly_when_it_couldnt(self):
        self.assistant()
        self.next_address = None
        with self.assertRaises(self.machines.Fail) as e:
            self.tell({"target": "t3", "route": "", "address": "t3", "space": "sp1", "space_name": "shop"})
        self.assertIn("plain shell", str(e.exception))
        self.assertIn("nothing was typed", str(e.exception))
        self.assertEqual(self.typed(), [])

    def test_tell_assistant_on_another_machine_types_nothing_into_its_shell(self):
        from unittest import mock
        self.assistant()
        with mock.patch.object(self.machines.subprocess, "run", lambda argv, **kw: self.news.run(argv[argv.index("--") + 1:])), \
                mock.patch.object(self.machines, "guard", lambda a: None), \
                mock.patch.object(self.machines, "typing", lambda *a, **k: None):
            with self.assertRaises(self.machines.Fail) as e:
                self.machines._deliver(["vm-b"], ["herdr-core"], "t3", "hello")
        self.assertIn("plain shell", str(e.exception))
        self.assertEqual(self.typed(), [])


class RepoSettings(unittest.TestCase):
    """SHEP-335: the settings that shape a task are the repo's it works in, whichever space started it: Everywhere,
    then the repo (settings.json "repos"), then the task's own --set. A throwaway settings file; no hc."""

    def setUp(self):
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.settings as settings
        self.settings = settings
        self.dir = tempfile.mkdtemp()
        self.file = os.path.join(self.dir, "settings.json")
        p = mock.patch.object(settings, "SETTINGS", self.file)
        p.start()
        self.addCleanup(p.stop)
        self.repo = os.path.join(self.dir, "shop")
        self.store = types.SimpleNamespace(loc={"folder": self.repo, "kind": "repo"})

    def write(self, d):
        with open(self.file, "w") as f:
            json.dump(d, f)

    def merge(self, task):
        return next(x for x in self.settings.task_settings(self.store, task) if x["label"] == "Merge")

    def test_everywhere_then_the_repo_then_the_task(self):
        self.write({"everywhere": {"tasks": {"merge": "checks", "proof": False}},
                    "repos": {self.repo: {"tasks": {"merge": "auto"}}}, "spaces": {"sproot": {"folder": "/", "name": "root"}}})
        # started by root (its folder is /), it works in the shop repo: the shop repo's Merge
        t = {"id": "SHOP-1", "mode": "worktree", "space": "sproot"}
        m = self.merge(t)
        self.assertEqual((m["value"], m["by"], m["from"]), ("auto", "repo", "repo"))
        self.assertIn("(this repo's setting)", self.settings.settings_block(self.store, t, argv=["claude"]))
        self.assertEqual(self.settings.merge_policy(self.store, t), "auto")
        # Everywhere's where the repo sets nothing
        proof = next(x for x in self.settings.task_settings(self.store, t) if x["label"] == "Proof")
        self.assertEqual((proof["value"], proof["by"]), (False, "all"))
        # the task's own --set wins
        self.settings.set_task(t, "merge", "ask me first")
        self.assertEqual((self.merge(t)["value"], self.merge(t)["by"]), ("ask", "task"))
        # another repo of the same space gets Everywhere's
        other = types.SimpleNamespace(loc={"folder": os.path.join(self.dir, "blog"), "kind": "repo"})
        self.assertEqual(self.settings.merge_policy(other, {"space": "sproot"}), "checks")

    def test_a_space_on_the_repo_no_longer_sets_its_tasks_once_moved(self):
        self.write({"repos": {self.repo: {"tasks": {"merge": "checks"}}},
                    "spaces": {"sp1": {"folder": self.repo, "tasks": {"merge": "auto"}, "worker": {"agent": "codex"}}}})
        self.assertEqual(self.settings.merge_policy(self.store, {"space": "sp1"}), "checks")
        self.assertEqual(self.settings.worker_pick(self.store, {"space": "sp1"})["agent"], "claude")

    def test_a_file_not_moved_yet_reads_the_space_on_the_repo(self):
        """Before the update moves them: a space whose folder is the repo still gives its tasks its values, as before."""
        self.write({"spaces": {"sp1": {"folder": self.repo, "tasks": {"merge": "auto"}}, "sproot": {"folder": "/", "tasks": {"merge": "checks"}}}})
        m = self.merge({"space": "sproot", "mode": "worktree"})
        self.assertEqual((m["value"], m["by"]), ("auto", "repo"))

    def test_a_spaces_own_settings_stay_the_spaces(self):
        """What is about the space (Suggested replies) comes from the space that started the task, not the repo."""
        self.write({"spaces": {"sproot": {"folder": "/", "agents": {"suggestions": False}}},
                    "repos": {self.repo: {"tasks": {"merge": "auto"}}}})
        sug = next(x for x in self.settings.task_settings(self.store, {"space": "sproot"}) if x["label"] == "Suggested replies")
        self.assertEqual((sug["value"], sug["by"], sug["from"]), (False, "space", "space"))

    def test_sources(self):
        self.write({"everywhere": {"tasks": {"proof": False}}, "machines": {"local": {"tasks": {"must_fix": "minor"}}},
                    "repos": {self.repo: {"tasks": {"merge": "auto"}, "worker": {"agent": "codex"}}}})
        src = self.settings.setting_sources(self.store)
        self.assertEqual(src["tasks.merge"], "repo")
        self.assertEqual(src["tasks.proof"], "Everywhere")
        self.assertEqual(src["tasks.must_fix"], "machine")
        self.assertEqual(src["tasks.review_rounds"], "default")
        self.assertEqual(src["worker"], "repo")
        # show: every line says where it comes from, the defaults too
        block = self.settings.settings_block(self.store, {"mode": "worktree"}, argv=["claude"], sources=True)
        self.assertIn("- Review: off (Herdr's default)", block)
        self.assertIn("(this repo's setting)", block)
        self.assertIn("(your setting everywhere)", block)

    def test_config_show_and_add_say_where_from(self):
        """The real CLI on a scratch repo, a fake hc (refusing) first on PATH: config lists each value's source, add says
        what the new task got from its repo; show's lines mark every value's source."""
        tmp = self.dir
        os.makedirs(os.path.join(tmp, "bin"))
        with open(os.path.join(tmp, "bin", "hc"), "w") as f:
            f.write("#!/bin/sh\nexit 1\n")
        os.chmod(os.path.join(tmp, "bin", "hc"), 0o755)
        repo = os.path.realpath(os.path.join(tmp, "repo-shep335-cli"))
        os.makedirs(repo)
        subprocess.run(["git", "-C", repo, "init", "-q"], check=True)
        subprocess.run(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "i"], check=True)
        self.write({"everywhere": {"tasks": {"merge": "checks"}}, "repos": {repo: {"tasks": {"merge": "auto"}}},
                    "spaces": {"sproot": {"folder": "/", "name": "root"}}})
        env = {"HOME": os.environ["HOME"], "PATH": f"{tmp}/bin:/usr/bin:/bin", "HC_SESSION": "t335", "SHEPHERDR_SESSION": "t335",
               "HERDR_TASK_STORE": os.path.join(tmp, "store"), "HERDR_TASK_SETTINGS": self.file, "SHEPHERDR_NO_MIGRATE": "1"}
        cli = [sys.executable, os.path.join(BIN, "herdr-task")]

        def run(*args):
            p = subprocess.run(cli + list(args), capture_output=True, text=True, env=env)
            self.assertEqual(p.returncode, 0, p.stderr)
            return p.stdout
        conf = json.loads(run("config", "--folder", repo, "--json"))
        self.assertEqual(conf["settings"]["tasks"]["merge"], "auto")
        self.assertEqual(conf["from"]["tasks.merge"], "repo")
        self.assertIn('tasks.merge: "auto" (repo)', run("config", "--folder", repo))
        added = run("add", "Try it", "--folder", repo, "--space", "sproot")
        self.assertIn("Its settings: Merge on its own (this repo's setting).", added)
        # show asks hc (refused on a test's HOME): its lines are settings_block(sources=True), its JSON task_settings
        lists = [f for f in os.listdir(os.path.join(tmp, "store")) if f.endswith(".json") and not f.startswith(".")]
        with open(os.path.join(tmp, "store", lists[0])) as f:
            t = json.load(f)["tasks"][0]
        store = types.SimpleNamespace(loc={"folder": repo, "kind": "repo"})
        self.assertIn("- Merge: on its own: once you say ready, Herdr merges it, waiting only on checks its base branch requires (this repo's setting)",
                      self.settings.settings_block(store, t, argv=["claude"], sources=True))
        rows = {x["label"]: x for x in self.settings.task_settings(store, t, argv=["claude"])}
        self.assertEqual((rows["Merge"]["from"], rows["Review"]["from"]), ("repo", "default"))


class BackgroundWorkIsNoTurn(unittest.TestCase):
    """A Claude Code whose turn ended but whose background shell still runs says "working · 1 shell still running":
    herdr-task reads it at rest (base.at_rest), so its task isn't Working by that alone (own_work decides) and idle
    or done detection sees it quiet."""

    def setUp(self):
        sys.path.insert(0, BIN)
        import herdr_task.base as base
        self.base = base

    def test_at_rest(self):
        at_rest = self.base.at_rest
        for m in ("1 shell still running", "2 shells still running", "1 shell and 1 agent still running"):
            self.assertEqual(at_rest({"app": "claude-code", "state": "working", "msg": m}), {"app": "claude-code", "state": "done", "bg": m})
        for m in ("Running hc ls", "Waiting for 1 background agent to finish", None):
            self.assertEqual(at_rest({"state": "working", "msg": m})["state"], "working")
        self.assertEqual(at_rest({"state": "blocked", "msg": "1 shell still running"})["state"], "blocked")
        self.assertEqual(at_rest("working"), "working")

    def test_hc_json(self):
        from unittest import mock
        records = {"t1": {"address": "t1", "state": "live", "status": {"app": "claude-code", "state": "working", "msg": "1 shell still running"}},
                   "t2": {"address": "t2", "state": "live", "status": {"app": "claude-code", "state": "working", "msg": "Running npm test"}}}
        ls = {"terminals": [{"address": "t1", "agent": "claude-code", "state": "live", "status": "working"},
                            {"address": "t2", "agent": "claude-code", "state": "live", "status": "working"},
                            {"address": "t3", "agent": "codex", "state": "live", "status": "working"}]}
        asked = []

        def raw(*args):
            asked.append(args)
            return json.loads(json.dumps(ls)) if args[0] == "ls" else json.loads(json.dumps(records.get(args[1])))
        with mock.patch.object(self.base, "_hc_raw", raw):
            self.assertEqual([k["status"] for k in self.base.hc_json("ls")["terminals"]], ["done", "working", "working"])
            self.assertEqual(self.base.hc_json("get", "t1")["status"], {"app": "claude-code", "state": "done", "bg": "1 shell still running"})
            self.assertEqual(self.base.hc_json("get", "t2")["status"]["state"], "working")
        # only the working Claude Codes are read in full, never the Codex one
        self.assertNotIn(("get", "t3"), asked)
